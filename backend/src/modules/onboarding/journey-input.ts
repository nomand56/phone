import { BadRequestException } from "@nestjs/common";

export const capabilities = ["messages", "leads", "routing", "questions", "appointments", "crm"] as const;
export type Capability = typeof capabilities[number];
export type VoiceChoice = "juniper" | "jessica" | "eric" | "enrique";
export type Cadence = "monthly" | "yearly";
export interface DiscoveryAnswer { kind: string; detail?: string }
export interface Discovery {
  answer?: DiscoveryAnswer;
  missed?: DiscoveryAnswer;
  capabilities?: Capability[];
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Enter the requested information.");
  }
  return value as Record<string, unknown>;
}

export function discoveryInput(body: unknown): Partial<Discovery> {
  const { field, value } = record(body);
  if (field === "capabilities") {
    if (!Array.isArray(value) || value.length > capabilities.length
      || !value.every((id) => capabilities.includes(id as Capability))) {
      throw new BadRequestException("Choose from the available call tasks.");
    }
    return { capabilities: [...new Set(value)] as Capability[] };
  }
  if (field !== "answer" && field !== "missed") throw new BadRequestException("Choose a setup answer.");
  const { kind, detail } = record(value);
  const options = field === "answer" ? ["myself", "team", "service", "ai", "other"] : ["voicemail", "service", "ai", "other"];
  if (typeof kind !== "string" || !options.includes(kind)) throw new BadRequestException("Choose one of the listed options.");
  if (kind === "other") {
    const description = typeof detail === "string" ? detail.trim() : "";
    if (!description || description.length > 200) throw new BadRequestException("Describe your setup in 200 characters or fewer.");
    return { [field]: { kind, detail: description } };
  }
  return { [field]: { kind } };
}

export function voiceInput(value: unknown): VoiceChoice {
  if (value === "juniper" || value === "jessica" || value === "eric" || value === "enrique") return value;
  throw new BadRequestException("Choose an available voice.");
}

export function cadenceInput(value: unknown): Cadence {
  if (value === "monthly" || value === "yearly") return value;
  throw new BadRequestException("Choose monthly or yearly billing.");
}

export function numberInput(value: unknown): string {
  if (typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value)) return value;
  throw new BadRequestException("Choose an available phone number.");
}
