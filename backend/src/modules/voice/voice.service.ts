import {
	ForbiddenException,
	Inject,
	Injectable,
	type OnModuleDestroy,
	ServiceUnavailableException,
} from "@nestjs/common";
import type { Server } from "node:http";
import type { Request } from "express";
import twilio from "twilio";
import { WebSocket, WebSocketServer } from "ws";
import { Database } from "../../infrastructure/database/database.js";
import { RedisStore } from "../../infrastructure/redis/redis-store.js";
import type { Capability } from "../onboarding/journey-input.js";
import type { Profile, Rules } from "../onboarding/onboarding-input.js";
import { previewReply } from "../onboarding/onboarding.service.js";
import { twilioConfig } from "../onboarding/provider-config.js";

interface Destination {
	tenant_key: string;
	profile: Profile;
	rules: Rules;
	capabilities: Capability[] | null;
}
interface Ticket extends Destination {
	from?: string;
}

const relayPath = "/voice/sessions";
const unavailable =
	"This receptionist is unavailable. Please try the business directly.";

@Injectable()
export class VoiceService implements OnModuleDestroy {
	private readonly relay = new WebSocketServer({
		noServer: true,
		maxPayload: 16_384,
	});

	constructor(
		@Inject(Database) private readonly database: Database,
		@Inject(RedisStore) private readonly redis: RedisStore,
	) {}

	attach(server: Server) {
		server.on("upgrade", (request, socket, head) => {
			const config = twilioConfig();
			const signature = request.headers["x-twilio-signature"];
			if (
				request.url !== relayPath ||
				!config?.origin ||
				typeof signature !== "string" ||
				![config.origin, config.origin.replace(/^https:/, "wss:")].some(
					(origin) =>
						twilio.validateRequest(
							config.token,
							signature,
							origin + relayPath,
							{},
						),
				)
			) {
				socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
				return;
			}
			this.relay.handleUpgrade(request, socket, head, (connection) =>
				this.handle(connection),
			);
		});
	}

	async inbound(request: Request, body: unknown): Promise<string> {
		const { payload, origin } = this.verify(request, body);
		const destination = await this.destination(payload.To);
		const response = new twilio.twiml.VoiceResponse();
		if (destination) {
			response
				.gather({
					input: ["dtmf"],
					numDigits: 1,
					timeout: 8,
					action: `${origin}/webhooks/twilio/consent`,
				})
				.say(
					"This is an AI receptionist. Your speech is transcribed and messages may be saved for the business. Press 1 to continue.",
				);
		}
		response.say(unavailable);
		return response.toString();
	}

	async consent(request: Request, body: unknown): Promise<string> {
		const { payload, origin } = this.verify(request, body);
		const destination =
			payload.Digits === "1" ? await this.destination(payload.To) : undefined;
		const response = new twilio.twiml.VoiceResponse();
		if (destination) {
			const from = /^\+[1-9]\d{7,14}$/.test(payload.From ?? "")
				? payload.From
				: undefined;
			await this.redis.cache(
				`phone:relay:${payload.CallSid}`,
				JSON.stringify({ ...destination, from }),
				75,
			);
			response
				.connect({ action: `${origin}/webhooks/twilio/end` })
				.conversationRelay({
					url: `${origin.replace(/^https:/, "wss:")}${relayPath}`,
					welcomeGreeting: destination.rules.greeting.slice(0, 320),
				});
		} else {
			response.say(unavailable);
		}
		return response.toString();
	}

	end(request: Request, body: unknown): string {
		const { payload } = this.verify(request, body);
		const response = new twilio.twiml.VoiceResponse();
		if (payload.SessionStatus === "failed") response.say(unavailable);
		return response.toString();
	}

	onModuleDestroy() {
		for (const connection of this.relay.clients) connection.terminate();
		this.relay.close();
	}

	private verify(request: Request, body: unknown) {
		const config = twilioConfig();
		if (!config?.origin)
			throw new ServiceUnavailableException("Voice is not configured.");
		const signature = request.header("x-twilio-signature");
		if (
			!signature ||
			!body ||
			typeof body !== "object" ||
			Array.isArray(body) ||
			!twilio.validateRequest(
				config.token,
				signature,
				config.origin + request.originalUrl,
				body as Record<string, string>,
			)
		) {
			throw new ForbiddenException("Invalid Twilio signature.");
		}
		const payload = body as Record<string, string>;
		if (
			payload.AccountSid !== config.account ||
			!/^CA[a-f0-9]{32}$/i.test(payload.CallSid ?? "")
		) {
			throw new ForbiddenException("Invalid Twilio call.");
		}
		return { payload, origin: config.origin };
	}

	private async destination(number: string) {
		const {
			rows: [agent],
		} = await this.database.pool.query<Destination>(
			"SELECT * FROM public.receptionist_destination($1)",
			[number],
		);
		return agent;
	}

	private handle(connection: WebSocket) {
		let ticket: Ticket | undefined;
		let callSid: string;
		let takingMessage = false;
		let saved = false;
		let queue = Promise.resolve();
		const setupTimeout = setTimeout(() => connection.close(1008), 8_000);
		const callTimeout = setTimeout(() => connection.close(1000), 300_000);
		connection.once("close", () => {
			clearTimeout(setupTimeout);
			clearTimeout(callTimeout);
		});
		connection.on("error", () => connection.terminate());

		const say = (text: string) => {
			if (connection.readyState === WebSocket.OPEN)
				connection.send(
					JSON.stringify({ type: "text", token: text, last: true }),
				);
		};
		connection.on("message", (raw) => {
			queue = queue.then(async () => {
				if (connection.readyState !== WebSocket.OPEN) return;
				try {
					const event = JSON.parse(raw.toString()) as {
						type?: string;
						callSid?: string;
						last?: boolean;
						voicePrompt?: string;
					};
					if (
						event.type === "setup" &&
						!ticket &&
						event.callSid &&
						/^CA[a-f0-9]{32}$/i.test(event.callSid)
					) {
						const stored = await this.redis.take(
							`phone:relay:${event.callSid}`,
						);
						if (!stored) {
							connection.close(1008);
							return;
						}
						ticket = JSON.parse(stored) as Ticket;
						callSid = event.callSid;
						clearTimeout(setupTimeout);
						return;
					}
					if (
						!ticket ||
						event.type !== "prompt" ||
						event.last !== true ||
						typeof event.voicePrompt !== "string"
					)
						return;
					const message = event.voicePrompt.trim().slice(0, 1200);
					if (!message) return;
					if (takingMessage && !saved) {
						const captured = ticket;
						await this.database.transaction(async (client) => {
							await client.query(
                "SELECT set_config('app.voice_tenant_id', $1, true), set_config('app.voice_call_sid', $2, true)",
                [captured.tenant_key, callSid],
							);
							await client.query(
								`INSERT INTO receptionist_messages (call_sid, tenant_id, callback_number, message)
               VALUES ($1, $2, $3, $4) ON CONFLICT (call_sid) DO NOTHING`,
								[callSid, captured.tenant_key, captured.from ?? null, message],
							);
						});
						saved = true;
						takingMessage = false;
						say("Thank you. Your message was saved for the team.");
					} else if (
						/\b(message|callback|call me back|speak to (someone|a person)|appointment|book)\b/i.test(
							message,
						) &&
						!saved
					) {
						takingMessage = true;
						say(
							`${ticket.rules.intake} Please include those details together in your next reply.`,
						);
					} else {
						say(previewReply(message, ticket.profile, ticket.rules));
					}
				} catch {
					say(unavailable);
					connection.close(1011);
				}
			});
		});
	}
}
