import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { type NextFunction, type Request, type Response, json, raw, urlencoded } from "express";
import { AppModule } from "./app.module.js";
import { webOrigin } from "./config/env.js";
import { VoiceService } from "./modules/voice/voice.service.js";

export async function createApp(): Promise<NestExpressApplication> {
  webOrigin();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use("/webhooks/stripe", raw({ type: "application/json", limit: "256kb" }));
  app.use("/webhooks/twilio", urlencoded({ extended: false, limit: "16kb", parameterLimit: 60 }));
  app.use(json({ limit: "32kb" }));
  app.get(VoiceService).attach(app.getHttpServer());
  return app;
}
