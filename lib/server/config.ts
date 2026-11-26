export interface ServerConfig {
  origin: string;
  sessionLifetime: number;
  resultLifetime: number;
  jobTimeout: number;
  maxSessions: number;
  maxJobs: number;
  streaming: boolean;
}

export function serverConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const streaming = overrides.streaming ?? process.env.VERCEL === '1';
  const configuredOrigin =
    overrides.origin ??
    process.env.APP_ORIGIN ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (process.env.NODE_ENV === 'production' && !configuredOrigin) {
    throw new Error(
      'Set APP_ORIGIN to the public application URL before starting production.',
    );
  }

  const url = new URL(configuredOrigin || 'http://localhost:3000');

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('APP_ORIGIN must be an HTTP or HTTPS URL without credentials.');
  }

  return {
    sessionLifetime: 30 * 60_000,
    resultLifetime: 30 * 60_000,
    jobTimeout: streaming ? 270_000 : 10 * 60_000,
    maxSessions: 128,
    maxJobs: 10,
    streaming,
    ...overrides,
    origin: url.origin,
  };
}
