import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from './config.ts';

export interface Session {
  id: string;
  token: string;
  expires: number;
  requests: number;
  windowStarted: number;
}

export class Sessions {
  private readonly entries = new Map<string, Session>();
  private readonly config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  get(request: IncomingMessage): Session | undefined {
    const id = request.headers.cookie?.match(
      /(?:^|;\s*)svg_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const session = id ? this.entries.get(id) : undefined;

    if (!session || session.expires <= Date.now()) return undefined;

    return session;
  }

  open(request: IncomingMessage, response: ServerResponse): Session | undefined {
    this.prune();
    let session = this.get(request);

    if (!session) {
      if (this.entries.size >= this.config.maxSessions) return undefined;

      session = {
        id: randomBytes(32).toString('hex'),
        token: randomBytes(32).toString('hex'),
        expires: 0,
        requests: 0,
        windowStarted: Date.now(),
      };
      this.entries.set(session.id, session);
    }

    session.expires = Date.now() + this.config.sessionLifetime;
    const secure = this.config.origin.startsWith('https:') ? '; Secure' : '';

    response.setHeader(
      'Set-Cookie',
      `svg_session=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(this.config.sessionLifetime / 1000)}${secure}`,
    );

    return session;
  }

  allowRequest(session: Session): boolean {
    if (Date.now() - session.windowStarted >= 60_000) {
      session.windowStarted = Date.now();
      session.requests = 0;
    }

    session.requests += 1;
    session.expires = Date.now() + this.config.sessionLifetime;
    return session.requests <= 60;
  }

  prune(): void {
    for (const [id, session] of this.entries) {
      if (session.expires <= Date.now()) this.entries.delete(id);
    }
  }
}
