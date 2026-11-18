import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { assertWebOrigin } from "../../http/require-web-origin.js";
import { AuthService } from "../auth/auth.service.js";
import { readSessionToken } from "../auth/session.js";
import { discoveryInput, voiceInput } from "./journey-input.js";
import { phoneInput, previewInput, profileInput, rulesInput, websiteInput } from "./onboarding-input.js";
import { OnboardingService } from "./onboarding.service.js";

@Controller("v1/onboarding")
export class OnboardingController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  @Get()
  async read(@Req() request: Request) {
    return this.onboarding.read(await this.session(request));
  }

  @Get("messages")
  async messages(@Req() request: Request) {
    return this.onboarding.messages(await this.session(request));
  }

  @Patch("discovery")
  async saveDiscovery(@Req() request: Request, @Body() body: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.saveDiscovery(await this.session(request), discoveryInput(body));
  }

  @Post("train/manual")
  @HttpCode(200)
  async trainManual(@Req() request: Request, @Body() body: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.saveTraining(await this.session(request), profileInput(body), null);
  }

  @Post("train/website")
  async trainWebsite(@Req() request: Request, @Body("website") website: unknown, @Res() response: Response) {
    assertWebOrigin(request.headers.origin);
    const session = await this.session(request);
    const input = websiteInput(website);
    const cancelled = new AbortController();
    response.once("close", () => cancelled.abort());
    response.type("application/x-ndjson").set("X-Accel-Buffering", "no");
    const emit = (event: object) => {
      if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const setup = await this.onboarding.train(session, input, emit, cancelled.signal);
      emit({ stage: "complete", setup });
    } catch (error) {
      if (!cancelled.signal.aborted) emit({ stage: "error", message: error instanceof Error ? error.message : "Training couldn’t be completed." });
    } finally {
      response.end();
    }
  }

  @Patch("voice")
  async saveVoice(@Req() request: Request, @Body("voice") voice: unknown, @Body("skipped") skipped: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.saveVoice(await this.session(request), voiceInput(voice), skipped === true);
  }

  @Post("realtime")
  @HttpCode(200)
  async realtime(@Req() request: Request, @Body("voice") voice: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.realtime(await this.session(request), voiceInput(voice));
  }

  @Post("website")
  @HttpCode(200)
  async importWebsite(@Req() request: Request, @Body("website") website: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.import(await this.session(request), websiteInput(website));
  }

  @Patch("profile")
  async saveProfile(@Req() request: Request, @Body() body: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.saveProfile(await this.session(request), profileInput(body));
  }

  @Patch("rules")
  async saveRules(@Req() request: Request, @Body() body: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.saveRules(await this.session(request), rulesInput(body));
  }

  @Post("preview")
  @HttpCode(200)
  async preview(@Req() request: Request, @Body("message") message: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.preview(await this.session(request), previewInput(message));
  }

  @Patch("phone")
  async savePhone(@Req() request: Request, @Body() body: unknown) {
    assertWebOrigin(request.headers.origin);
    return this.onboarding.savePhone(await this.session(request), phoneInput(body));
  }

  private session(request: Request) {
    return this.auth.requireSession(readSessionToken(request.headers.cookie));
  }
}
