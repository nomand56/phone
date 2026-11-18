import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { webOrigin } from "../../config/env.js";
import { assertWebOrigin } from "../../http/require-web-origin.js";
import { AuthService } from "./auth.service.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, readSessionToken } from "./session.js";
import { SignupService } from "./signup.service.js";

function parseEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("Enter a valid email address.");
  }
  return email;
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

@Controller("v1/auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SignupService) private readonly signup: SignupService,
  ) {}

  @Post("signup")
  @HttpCode(202)
  async requestSignup(@Req() request: Request, @Body("email") email: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.signup.requestLink(parseEmail(email), request.ip ?? "unknown");
  }

  @Post("signup/verify")
  @HttpCode(204)
  async verifySignup(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    assertWebOrigin(request.headers.origin);
    if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
      throw new BadRequestException("Open a valid email verification link.");
    }
    if (!("password" in body) || typeof body.password !== "string" || body.password.length < 14
      || Buffer.byteLength(body.password, "utf8") > 1024) {
      throw new BadRequestException("Use a password of at least 14 characters.");
    }
    const token = await this.signup.complete(
      body.token, body.password, request.ip ?? "unknown", readSessionToken(request.headers.cookie),
    );
    response.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
  }

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
