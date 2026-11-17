import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { webOrigin } from "../../config/env.js";
import { assertWebOrigin } from "../../http/require-web-origin.js";
import { AuthService } from "./auth.service.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, readSessionToken } from "./session.js";

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

@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(204)
  async login(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    assertWebOrigin(request.headers.origin);
    const token = await this.auth.login(
      parseCredentials(body), request.ip ?? "unknown", readSessionToken(request.headers.cookie),
    );
    response.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertWebOrigin(request.headers.origin);
    await this.auth.logout(readSessionToken(request.headers.cookie));
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  private cookieOptions() {
    return { httpOnly: true, sameSite: "lax" as const, secure: webOrigin().startsWith("https:"), path: "/" };
  }
}
