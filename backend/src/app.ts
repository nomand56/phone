import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { type NextFunction, type Request, type Response, json } from "express";
import { AppModule } from "./app.module.js";
import { webOrigin } from "./config/env.js";

export async function createApp(): Promise<NestExpressApplication> {
  webOrigin();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(json({ limit: "8kb" }));
  return app;
}
