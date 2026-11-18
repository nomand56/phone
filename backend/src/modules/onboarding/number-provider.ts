import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import twilio from "twilio";
import { sandboxEnabled, twilioConfig } from "./provider-config.js";

interface Candidate { number: string; label: string; location: string }
const demoAreas = new Map([
  ["236", "British Columbia"], ["604", "Vancouver, BC"], ["250", "Victoria, BC"], ["778", "British Columbia"],
  ["403", "Calgary, AB"], ["780", "Edmonton, AB"], ["416", "Toronto, ON"], ["647", "Toronto, ON"],
  ["613", "Ottawa, ON"], ["514", "Montréal, QC"], ["902", "Atlantic Canada"],
]);

export async function numberOptions(query: string, contains?: string): Promise<Candidate[]> {
  if (sandboxEnabled()) {
    const area = query || (contains ? contains.substring(2, 5) : "236");
    return Array.from({ length: 4 }, (_, index) => {
      const last = `01${String(index + 10).padStart(2, "0")}`;
      return { number: `+1${area}555${last}`, label: `(${area}) 555-${last}`,
        location: demoAreas.get(area) ?? "Canadian test area code" };
    }).filter((item) => !contains || item.number === contains);
  }

  const config = twilioConfig();
  if (!config) throw new ServiceUnavailableException("Live number inventory requires a connected Twilio account.");
  try {
    const client = twilio(config.account, config.token, { timeout: 6500 });
    const inventory = client.availablePhoneNumbers("CA").local;
    const request = { voiceEnabled: true, limit: 8, ...(query ? { areaCode: Number(query) } : {}),
      ...(contains ? { contains: contains.slice(2) } : {}) };
    const result = await inventory.list(request);
    const available = !query && !contains && result.length === 0 ? await inventory.list({ voiceEnabled: true, limit: 8 }) : result;
    return available.filter((item) => !contains || item.phoneNumber === contains).map((item) => ({
      number: item.phoneNumber, label: item.friendlyName,
      location: [item.locality, item.region].filter(Boolean).join(", "),
    }));
  } catch {
    throw new ServiceUnavailableException("Couldn’t load available numbers. Please retry.");
  }
}

export function searchArea(query: unknown): string {
  if (query === "" || query === undefined) return "";
  if (typeof query === "string" && /^[2-9]\d{2}$/.test(query)) return query;
  throw new BadRequestException("Enter a three-digit Canadian area code.");
}

export async function rentNumber(number: string, attempt: string) {
  const config = twilioConfig();
  if (!config?.origin || process.env.TWILIO_PROVISIONING_ENABLED !== "true" || sandboxEnabled()) {
    return { state: "provisioning" } as const;
  }
  const client = twilio(config.account, config.token, { timeout: 7000 });
  const namespaced = `receptionist-${attempt}`;
  const existing = (await client.incomingPhoneNumbers.list({ phoneNumber: number, limit: 10 }))
    .find((item) => item.phoneNumber === number);
  if (existing) return existing.friendlyName === namespaced
    ? { state: "active", sid: existing.sid } as const : { state: "unavailable" } as const;

  try {
    const rented = await client.incomingPhoneNumbers.create({
      phoneNumber: number, friendlyName: namespaced, voiceUrl: `${config.origin}/webhooks/twilio/voice`, voiceMethod: "POST",
      ...(process.env.TWILIO_REGULATORY_BUNDLE_SID ? { bundleSid: process.env.TWILIO_REGULATORY_BUNDLE_SID } : {}),
      ...(process.env.TWILIO_ADDRESS_SID ? { addressSid: process.env.TWILIO_ADDRESS_SID } : {}),
    });
    return { state: "active", sid: rented.sid } as const;
  } catch (error) {
    const apiError = error as { code?: number };
    if (apiError.code === 21422) return { state: "unavailable" } as const;
    throw error;
  }
}
