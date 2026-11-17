import { BadRequestException, Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";
import type { Request } from "express";
import { assertWebOrigin } from "../../http/require-web-origin.js";
import { AuthService } from "../auth/auth.service.js";
import { readSessionToken } from "../auth/session.js";
import { TenantsService } from "./tenants.service.js";

function parseSettings(body: unknown) {
  if (!body || typeof body !== "object" || !("displayName" in body) || !("timeZone" in body)
    || Object.keys(body).some((key) => key !== "displayName" && key !== "timeZone")) {
    throw new BadRequestException("Provide a display name and time zone.");
  }
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const timeZone = typeof body.timeZone === "string" ? body.timeZone.trim() : "";
  if (!displayName || displayName.length > 120 || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
    throw new BadRequestException("Enter a business name between 1 and 120 characters.");
  }
  if (!timeZone || timeZone.length > 80 || !/^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) {
    throw new BadRequestException("Enter a valid time zone.");
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
  } catch {
    throw new BadRequestException("Enter a valid time zone.");
  }
  return { displayName, timeZone };
}

@Controller("v1/tenants/current")
export class TenantsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TenantsService) private readonly tenants: TenantsService,
  ) {}

  @Get()
  async current(@Req() request: Request) {
    const session = await this.auth.requireSession(readSessionToken(request.headers.cookie));
    return this.tenants.current(session);
  }

  @Patch()
  async update(@Req() request: Request, @Body() body: unknown) {
    assertWebOrigin(request.headers.origin);
    const settings = parseSettings(body);
    const session = await this.auth.requireSession(readSessionToken(request.headers.cookie));
    return this.tenants.update(session, settings);
  }
}
