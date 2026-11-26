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
          body: JSON.stringify(body),
        }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new ApiError(
      payload.error || 'The request could not be completed.',
      response.status,
    );
  }

  return payload as T;
}

export function bytes(value: number): string {
  return value >= 1048576
    ? `${(value / 1048576).toFixed(2)} MB`
    : `${(value / 1024).toFixed(1)} KB`;
}
