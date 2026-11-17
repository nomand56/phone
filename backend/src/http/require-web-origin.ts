import { ForbiddenException } from "@nestjs/common";
import { webOrigin } from "../config/env.js";

export function assertWebOrigin(origin: string | undefined): void {
  if (origin !== webOrigin()) {
    throw new ForbiddenException("Request origin is not allowed.");
  }
}
