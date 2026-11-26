export interface ServerConfig {
  origin: string;
  sessionLifetime: number;
  resultLifetime: number;
  jobTimeout: number;
  maxSessions: number;
  maxJobs: number;
}

export function serverConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const configuredOrigin = overrides.origin ?? process.env.APP_ORIGIN;

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
    jobTimeout: 10 * 60_000,
    maxSessions: 128,
    maxJobs: 10,
    ...overrides,
    origin: url.origin,
  };
}
