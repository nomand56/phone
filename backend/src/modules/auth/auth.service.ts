import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Database } from "../../infrastructure/database/database.js";
import { RedisStore } from "../../infrastructure/redis/redis-store.js";
import { verifyPassword } from "./password.js";
import { SESSION_TTL_SECONDS, type Session } from "./session.js";

interface UserRow {
  id: string;
  password_hash: string;
  verified_at: Date | null;
  disabled_at: Date | null;
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(RedisStore) private readonly redis: RedisStore,
  ) {}

  async login(
    { email, password }: { email: string; password: string },
    ip: string,
    previousToken: string | undefined,
  ): Promise<string> {
    await this.consumeLoginAttempt("source", ip, 100, 60);
    await this.consumeLoginAttempt("account", email, 10, 900);
    const { rows: [user] } = await this.database.pool.query<UserRow>(
      "SELECT id, password_hash, verified_at, disabled_at FROM users WHERE email = $1",
      [email],
    );
    if (!await verifyPassword(password, user?.password_hash) || !user?.verified_at || user.disabled_at) {
      throw new UnauthorizedException("Email or password is incorrect.");
    }

    const token = randomBytes(32).toString("base64url");
    await this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
      const { rows: [membership] } = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM tenant_memberships WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY created_at, tenant_id LIMIT 1`,
        [user.id],
      );
      if (!membership) throw new UnauthorizedException("Email or password is incorrect.");

      if (previousToken) {
        await client.query("DELETE FROM sessions WHERE token_hash = $1", [tokenDigest(previousToken)]);
      }
      await client.query(
        "INSERT INTO sessions (token_hash, tenant_id, user_id, expires_at) VALUES ($1, $2, $3, $4)",
        [tokenDigest(token), membership.tenant_id, user.id, new Date(Date.now() + SESSION_TTL_SECONDS * 1000)],
      );
    });
    return token;
  }

  async requireSession(token: string | undefined): Promise<Session> {
    if (!token) throw new UnauthorizedException("Sign in to continue.");
    const { rows: [session] } = await this.database.pool.query<Session>(
      `SELECT s.user_id, s.tenant_id FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
         AND u.verified_at IS NOT NULL AND u.disabled_at IS NULL`,
      [tokenDigest(token)],
    );
    if (!session) throw new UnauthorizedException("Sign in to continue.");
    return session;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) {
      await this.database.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenDigest(token)]);
    }
  }

  private async consumeLoginAttempt(scope: string, identifier: string, limit: number, seconds: number) {
    const digest = createHash("sha256").update(identifier).digest("hex");
    let attempts: unknown;
    try {
      attempts = await this.redis.incrementCounter(`phone:login:${scope}:${digest}`, seconds);
    } catch {
      throw new ServiceUnavailableException("Sign-in is temporarily unavailable.");
    }

    if (typeof attempts !== "number" || attempts > limit) {
      throw new HttpException("Too many sign-in attempts. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
