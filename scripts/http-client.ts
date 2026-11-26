import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

export type HttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export interface HttpResult {
  status: number;
  headers: OutgoingHttpHeaders;
  body: Buffer;
  json<T>(): T;
}

export function httpClient(handler: HttpHandler, origin = 'http://localhost:3000') {
  let cookie = '';
  let token = '';

  async function request(
    method: string,
    url: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResult> {
    const bytes =
      body === undefined
        ? []
        : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
    const request = Object.assign(Readable.from(bytes), {
      method,
      url,
      headers: {
        host: new URL(origin).host,
        origin,
        cookie,
        'content-type': 'application/json',
        'x-converter-token': token,
        ...extraHeaders,
      },
    }) as unknown as IncomingMessage;

    return new Promise((resolve, reject) => {
      const response = {
        statusCode: 200,
        headersSent: false,
        destroyed: false,
        headers: {} as OutgoingHttpHeaders,
        setHeader(name: string, value: string | string[] | number) {
          this.headers[name.toLowerCase()] = value;
          return this;
        },
        writeHead(status: number, headers: OutgoingHttpHeaders) {
          this.statusCode = status;
          this.headers = { ...this.headers, ...headers };
          this.headersSent = true;
          return this;
        },
        status(status: number) {
          this.statusCode = status;
          return this;
        },
        json(value: unknown) {
          this.end(Buffer.from(JSON.stringify(value)));
        },
        end(bytes: Buffer) {
          const setCookie = this.headers['set-cookie'];
          if (typeof setCookie === 'string') cookie = setCookie.split(';')[0];
          const result: HttpResult = {
            status: this.statusCode,
            headers: this.headers,
            body: bytes,
            json<T>() {
              return JSON.parse(bytes.toString()) as T;
            },
          };
          if (url === '/api/session' && this.statusCode === 200)
            token = result.json<{ token: string }>().token;
          resolve(result);
        },
      };

      handler(request, response as unknown as ServerResponse).catch(reject);
    });
  }

  return { request };
}
