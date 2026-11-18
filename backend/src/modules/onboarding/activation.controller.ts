import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { assertWebOrigin } from "../../http/require-web-origin.js";
import { AuthService } from "../auth/auth.service.js";
import { readSessionToken } from "../auth/session.js";
import { ActivationService } from "./activation.service.js";
import { cadenceInput, numberInput } from "./journey-input.js";
import { searchArea } from "./number-provider.js";

@Controller()
export class ActivationController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ActivationService) private readonly activation: ActivationService,
  ) {}

  @Get("v1/onboarding/numbers")
  async numbers(@Req() request: Request, @Query("areaCode") code: unknown) {
    return this.activation.numbers(await this.session(request), searchArea(code));
  }

  @Patch("v1/onboarding/number")
  async select(@Req() request: Request, @Body("number") number: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.activation.selectNumber(await this.session(request), numberInput(number));
  }

  @Get("v1/onboarding/plans")
  async plans(@Req() request: Request) {
    return this.activation.plans(await this.session(request));
  }

  @Post("v1/onboarding/checkout")
  @HttpCode(200)
  async checkout(@Req() request: Request, @Body("cadence") cadence: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.activation.begin(await this.session(request), cadenceInput(cadence));
  }

  @Get("v1/onboarding/activation")
  async status(@Req() request: Request) {
    return { activation: await this.activation.status(await this.session(request), false) };
  }

  @Post("v1/onboarding/activation/confirm")
  @HttpCode(200)
  async confirm(@Req() request: Request) {
    assertWebOrigin(request.headers.origin);
    return { activation: await this.activation.status(await this.session(request), true) };
  }

  @Post("v1/onboarding/billing-portal")
  @HttpCode(200)
  async portal(@Req() request: Request) {
    assertWebOrigin(request.headers.origin);
    return this.activation.portal(await this.session(request));
  }

  @Post("webhooks/stripe")
  @HttpCode(200)
  async webhook(@Req() request: Request, @Body() body: Buffer) {
    return this.activation.webhook(body, request.header("stripe-signature"));
  }

  private session(request: Request) {
    return this.auth.requireSession(readSessionToken(request.headers.cookie));
  }
}
