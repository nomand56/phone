import { Body, Controller, Header, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { VoiceService } from "./voice.service.js";

@Controller("webhooks/twilio")
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly voice: VoiceService) {}

  @Post("voice")
  @HttpCode(200)
  @Header("Content-Type", "text/xml")
  async inbound(@Req() request: Request, @Body() body: unknown) {
    return this.voice.inbound(request, body);
  }

  @Post("consent")
  @HttpCode(200)
  @Header("Content-Type", "text/xml")
  async consent(@Req() request: Request, @Body() body: unknown) {
    return this.voice.consent(request, body);
  }

  @Post("end")
  @HttpCode(200)
  @Header("Content-Type", "text/xml")
  async end(@Req() request: Request, @Body() body: unknown) {
    return this.voice.end(request, body);
  }
}
