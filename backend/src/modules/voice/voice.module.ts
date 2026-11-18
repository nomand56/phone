import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database/database.module.js";
import { RedisModule } from "../../infrastructure/redis/redis.module.js";
import { VoiceController } from "./voice.controller.js";
import { VoiceService } from "./voice.service.js";

@Module({ imports: [DatabaseModule, RedisModule], controllers: [VoiceController], providers: [VoiceService] })
export class VoiceModule {}
