import type { IncomingMessage, ServerResponse } from 'node:http';
import { Document } from './animation.ts';
import { ConversionError, MAX_INPUT, settings } from './document.ts';
import { errorMessage } from './errors.ts';
import { serverConfig, type ServerConfig } from './server/config.ts';
import { Jobs } from './server/jobs.ts';
import { Sessions } from './server/sessions.ts';
import { streamExport } from './server/stream.ts';
import type { ConversionOptions } from './types.ts';

function respond(
  response: ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json',
): void {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(bytes);
}

async function readPayload(
  request: IncomingMessage,
  limit: number,
): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > limit)
      throw new ConversionError('Request is too large. Choose a smaller SVG.');
    chunks.push(buffer);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ConversionError('Invalid JSON.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ConversionError('Expected a JSON object.');
  }

  return payload as Record<string, unknown>;
}

export async function createApi(overrides: Partial<ServerConfig> = {}) {
  const config = serverConfig(overrides);
  const sessions = new Sessions(config);
  const jobs = await Jobs.create(config);
  const maxRequestBytes = config.streaming ? 4 * 1024 * 1024 : MAX_INPUT * 2;
  let streaming = false;
  const cleanup = setInterval(() => {
    sessions.prune();
    void jobs
      .prune()
      .catch((error) => console.error('Export cleanup failed:', errorMessage(error)));
  }, 60_000);
  cleanup.unref();

  async function handler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const pathname = new URL(request.url || '/', config.origin).pathname;

      if (request.method === 'GET' && pathname === '/api/health') {
        respond(response, 200, { status: 'ok' });
        return;
      }

      const configuredHost = new URL(config.origin).host;
      const host = request.headers.host;
      const deploymentHost = config.streaming && host === process.env.VERCEL_URL;
      const localHost =
        process.env.NODE_ENV !== 'production' &&
        /^(?:localhost|127\.0\.0\.1):\d+$/.test(host || '');

      if (host !== configuredHost && !localHost && !deploymentHost) {
        respond(response, 403, { error: 'Use the configured application URL.' });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/session') {
        if (config.streaming) {
          respond(response, 200, { token: 'stream', mode: 'stream', maxRequestBytes });
          return;
        }
        const session = sessions.open(request, response);
        respond(
          response,
          session ? 200 : 429,
          session
            ? { token: session.token, mode: 'jobs', maxRequestBytes }
            : { error: 'The server is busy. Try again shortly.' },
        );
        return;
      }

      const session = sessions.get(request);
      if (!session && !config.streaming) {
        respond(response, 403, {
          error: 'Your session expired. Reload the page before continuing.',
        });
        return;
      }

      if (request.method === 'GET') {
        if (!session || config.streaming) {
          respond(response, 404, { error: 'Export again to download your GIF.' });
          return;
        }
        const match = /^\/api\/jobs\/([a-f0-9]{32})(\/download)?$/.exec(pathname);
        const job = match ? jobs.get(match[1], session.id) : undefined;

        if (!match || !job) {
          respond(response, 404, {
            error: 'Export expired or not found. Convert the SVG again.',
          });
          return;
        }

        if (!match[2]) {
          respond(response, 200, job);
          return;
        }

        const gif = await jobs.download(match[1], session.id);
        if (!gif) {
          respond(response, 409, { error: 'GIF is not ready.' });
          return;
        }

        respond(response, 200, gif, 'image/gif');
        return;
      }

      if (request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        respond(response, 405, { error: 'Method not allowed.' });
        return;
      }

      const origin = request.headers.origin;
      const localOrigin = localHost && origin === `http://${host}`;
      const deploymentOrigin = deploymentHost && origin === `https://${host}`;
      if (
        request.headers['x-converter-token'] !==
          (config.streaming ? 'stream' : session?.token) ||
        (config.streaming && !origin) ||
        (origin && origin !== config.origin && !localOrigin && !deploymentOrigin)
      ) {
        respond(response, 403, {
          error: 'The request could not be verified. Reload the page.',
        });
        return;
      }

      if (session && !sessions.allowRequest(session)) {
        response.setHeader('Retry-After', '60');
        respond(response, 429, { error: 'Too many requests. Try again in one minute.' });
        return;
      }

      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
        respond(response, 415, { error: 'Expected application/json.' });
        return;
      }

      const payload = await readPayload(request, maxRequestBytes);
      const cancel = /^\/api\/jobs\/([a-f0-9]{32})\/cancel$/.exec(pathname);
      if (cancel && session && !config.streaming) {
        const found = jobs.cancel(cancel[1], session.id);
        respond(
          response,
          found ? 200 : 404,
          found ? { ok: true } : { error: 'Export not found.' },
        );
        return;
      }

      if (!['/api/inspect', '/api/convert'].includes(pathname)) {
        respond(response, 404, { error: 'Not found.' });
        return;
      }

      if (typeof payload.svg !== 'string')
        throw new ConversionError('Choose an SVG file.');
      const metadata = new Document(payload.svg).metadata();

      if (pathname === '/api/inspect') {
        respond(response, 200, metadata);
        return;
      }

      settings(metadata, payload.options);
      if (config.streaming) {
        if (streaming) {
          respond(response, 409, {
            error: 'Another export is running. Please try again shortly.',
          });
          return;
        }
        streaming = true;
        try {
          await streamExport(
            response,
            payload.svg,
            (payload.options ?? {}) as ConversionOptions,
            config.jobTimeout,
          );
        } finally {
          streaming = false;
        }
        return;
      }
      const id = await jobs.start(
        session!.id,
        payload.svg,
        (payload.options ?? {}) as ConversionOptions,
      );
      respond(
        response,
        id ? 202 : 409,
        id ? { id } : { error: 'Another export is running. Please try again shortly.' },
      );
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const expected = error instanceof ConversionError;
        if (!expected) console.error('API request failed:', errorMessage(error));
        respond(response, expected ? 400 : 500, {
          error: expected ? error.message : 'The server could not complete this request.',
        });
      }
    }
  }

  async function close(): Promise<void> {
    clearInterval(cleanup);
    await jobs.close();
  }

  return { handler, close };
}
