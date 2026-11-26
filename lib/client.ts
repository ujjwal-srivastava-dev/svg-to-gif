import type { ConversionProgress, ConversionResult, ExportEvent } from './types.ts';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = { ok: boolean }>(
  path: string,
  token: string | null,
  body?: unknown,
  signal?: AbortSignal,
  maxRequestBytes?: number,
): Promise<T> {
  const response = await fetch(path, {
    signal,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Converter-Token': token || '',
          },
          body: encodePayload(body, maxRequestBytes),
        }),
  });
  const payload = await response.json().catch(() => {
    throw new ApiError(
      response.status === 413
        ? 'This SVG is too large for the server. Choose a smaller file.'
        : 'The server could not complete the request. Please try again.',
      response.status,
    );
  });

  if (!response.ok) {
    throw new ApiError(
      payload.error || 'The request could not be completed.',
      response.status,
    );
  }

  return payload as T;
}

function encodePayload(body: unknown, limit = Infinity): string {
  const payload = JSON.stringify(body);
  if (new TextEncoder().encode(payload).byteLength > limit)
    throw new Error('This SVG is too large to upload. Reduce its size and try again.');
  return payload;
}

export async function streamGif(
  body: unknown,
  token: string,
  maxRequestBytes: number,
  signal: AbortSignal,
  progress: (value: ConversionProgress) => void,
): Promise<{ blob: Blob; result: ConversionResult }> {
  const response = await fetch('/api/convert', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Converter-Token': token },
    body: encodePayload(body, maxRequestBytes),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      payload?.error || 'Export failed. Try a smaller size or shorter duration.',
      response.status,
    );
  }
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let pending = '';
  let result: ConversionResult | undefined;
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ExportEvent;
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'progress') progress(event);
        if (event.type === 'chunk') {
          const chunk = Uint8Array.from(atob(event.data), (character) =>
            character.charCodeAt(0),
          );
          chunks.push(chunk);
          received += chunk.byteLength;
        }
        if (event.type === 'done') result = event.result;
      }
      if (done) break;
    }
    if (!result || pending.trim() || received !== result.bytes)
      throw new Error('Export was interrupted. Please try again.');
    return { blob: new Blob(chunks, { type: 'image/gif' }), result };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function bytes(value: number): string {
  return value >= 1048576
    ? `${(value / 1048576).toFixed(2)} MB`
    : `${(value / 1024).toFixed(1)} KB`;
}
