import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { webOrigin } from "./config.js";
import { Database } from "./database.js";
import { verifyPassword } from "./password.js";
import { RedisStore } from "./redis-store.js";

export const sessionCookie = "phone_session";
const sessionSeconds = 8 * 60 * 60;

interface UserRow {
  id: string;
  password_hash: string;
  verified_at: Date | null;
  disabled_at: Date | null;
}

interface Session {
  user_id: string;
  tenant_id: string;
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function readSessionToken(request: Request): string | undefined {
  const prefix = `${sessionCookie}=`;
  const cookies = request.headers.cookie?.split(";").map((part) => part.trim()) ?? [];
  const matches = cookies.filter((cookie) => cookie.startsWith(prefix));
  const candidate = matches.length === 1 ? matches[0].slice(prefix.length) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : undefined;
}

export function assertWebOrigin(request: Request): void {
  if (request.headers.origin !== webOrigin()) {
    throw new ForbiddenException("Request origin is not allowed.");
  }
}

function parseCredentials(body: unknown) {
  if (!body || typeof body !== "object" || !("email" in body) || !("password" in body)) {
    throw new BadRequestException("Enter an email and password.");
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !password || Buffer.byteLength(password, "utf8") > 1024) {
    throw new BadRequestException("Enter a valid email and password.");
  }
  return { email, password };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(RedisStore) private readonly redis: RedisStore,
  ) {}

  async login(request: Request, body: unknown): Promise<string> {
    const { email, password } = parseCredentials(body);
    await this.redis.limitLogin(request.ip ?? "unknown", email);
    const { rows: [user] } = await this.database.pool.query<UserRow>(
      "SELECT id, password_hash, verified_at, disabled_at FROM users WHERE email = $1",
      [email],
    );
    if (!await verifyPassword(password, user?.password_hash) || !user?.verified_at || user.disabled_at) {
      throw new UnauthorizedException("Email or password is incorrect.");
    }

    const token = randomBytes(32).toString("base64url");
    const previousToken = readSessionToken(request);
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
        [tokenDigest(token), membership.tenant_id, user.id, new Date(Date.now() + sessionSeconds * 1000)],
      );
    });
    return token;
  }

  async requireSession(request: Request): Promise<Session> {
    const token = readSessionToken(request);
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

  async logout(request: Request): Promise<void> {
    const token = readSessionToken(request);
    if (token) {
      await this.database.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenDigest(token)]);
    }
  }
}

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(204)
  async login(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    assertWebOrigin(request);
    const token = await this.auth.login(request, body);
    response.cookie(sessionCookie, token, { ...this.cookieOptions(), maxAge: sessionSeconds * 1000 });
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertWebOrigin(request);
    await this.auth.logout(request);
    response.clearCookie(sessionCookie, this.cookieOptions());
  }

  private cookieOptions() {
    return { httpOnly: true, sameSite: "lax" as const, secure: webOrigin().startsWith("https:"), path: "/" };
  }
}
