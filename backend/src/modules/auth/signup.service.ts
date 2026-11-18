import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { webOrigin } from "../../config/env.js";
import { Database } from "../../infrastructure/database/database.js";
import { RedisStore } from "../../infrastructure/redis/redis-store.js";
import { AuthService } from "./auth.service.js";
import { hashPassword } from "./password.js";
import type { Session } from "./session.js";

const invalidLink = "This verification link has expired or has already been used.";

function tokenHash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

@Injectable()
export class SignupService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(RedisStore) private readonly redis: RedisStore,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async requestLink(email: string, source: string): Promise<{ localVerificationUrl?: string }> {
    await this.limit("source", source, 30);
    await this.limit("address", email, 4);
    const origin = webOrigin();
    const localPreview = process.env.AUTH_LOCAL_VERIFICATION === "true"
      && process.env.NODE_ENV !== "production"
      && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);

    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_FROM_EMAIL;
    if (!localPreview && (!resendKey || !from)) {
      throw new ServiceUnavailableException("Email verification is temporarily unavailable.");
    }
    const existing = await this.database.pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (existing.rowCount) return {};

    const token = randomBytes(32).toString("base64url");
    const hash = tokenHash(token);
    await this.database.pool.query(
      `INSERT INTO signup_tokens (email, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')
       ON CONFLICT (email) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at`,
      [email, hash],
    );
    const url = `${origin}/signup/verify#token=${token}`;
    if (localPreview) return { localVerificationUrl: url };

    try {
      const result = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Verify your AI Receptionist account",
          text: `Open this link within 30 minutes to finish creating your account:\n\n${url}`,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!result.ok) throw new Error("Email provider rejected the request.");
    } catch {
      throw new ServiceUnavailableException("The verification email could not be sent. Please try again.");
    }
    return {};
  }

  async complete(value: string, password: string, source: string, previousToken?: string): Promise<string> {
    await this.limit("verify", source, 30);
    const hash = tokenHash(value);
    const active = await this.database.pool.query(
      "SELECT 1 FROM signup_tokens WHERE token_hash = $1 AND expires_at > now()", [hash],
    );
    if (!active.rowCount) throw new BadRequestException(invalidLink);
    const passwordHash = await hashPassword(password);
    const token = await this.database.transaction(async (client) => {
      const { rows: [session] } = await client.query<Session>(
        "SELECT user_id, tenant_id FROM public.claim_receptionist_signup($1, $2)", [hash, passwordHash],
      );
      return session ? this.auth.issueSession(client, session, previousToken) : undefined;
    });
    if (!token) throw new BadRequestException(invalidLink);
    return token;
  }

  private async limit(scope: string, identifier: string, max: number) {
    let count: unknown;
    try {
      count = await this.redis.incrementCounter(`phone:signup:${scope}:${tokenHash(identifier).toString("hex")}`, 900);
    } catch {
      throw new ServiceUnavailableException("Account signup is temporarily unavailable.");
    }
    if (typeof count !== "number" || count > max) {
      throw new HttpException("Too many attempts. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
