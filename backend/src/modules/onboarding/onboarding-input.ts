import { BadRequestException } from "@nestjs/common";
import { parseWebsite } from "./website-import.js";

export interface Profile {
  name: string;
  website: string;
  knowledge: string;
}

export interface Rules {
  greeting: string;
  intake: string;
  fallback: string;
}

export interface PhonePreferences {
  mode: "existing" | "new";
  existingNumber?: string;
  forwarding?: "all" | "missed" | "after_hours";
  areaCode?: string;
}

function fields(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Enter the requested information.");
  }
  return body as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum: number, required = true): string {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > maximum) {
    throw new BadRequestException(`${label} needs ${required ? "1–" : "at most "}${maximum} characters.`);
  }
  return result;
}

export function websiteInput(value: unknown): string {
  return text(value, "Website", 320);
}

export function profileInput(body: unknown): Profile {
  const value = fields(body);
  const website = text(value.website, "Website", 320, false);
  return {
    name: text(value.name, "Business name", 120),
    website: website ? parseWebsite(website).href : "",
    knowledge: text(value.knowledge, "Business information", 4000),
  };
}

export function rulesInput(body: unknown): Rules {
  const value = fields(body);
  return {
    greeting: text(value.greeting, "Greeting", 320),
    intake: text(value.intake, "Intake instructions", 800),
    fallback: text(value.fallback, "Fallback message", 320),
  };
}

export function previewInput(value: unknown): string {
  return text(value, "Test message", 300);
}

export function phoneInput(body: unknown): PhonePreferences {
  const { mode, existingNumber, forwarding, areaCode } = fields(body);
  if (mode === "new") {
    if (typeof areaCode !== "string" || !/^[2-9]\d{2}$/.test(areaCode)) {
      throw new BadRequestException("Enter a three-digit area code.");
    }
    return { mode, areaCode };
  }
  if (mode !== "existing" || (forwarding !== "all" && forwarding !== "missed" && forwarding !== "after_hours")) {
    throw new BadRequestException("Choose a phone setup option and a forwarding preference.");
  }
  const number = text(existingNumber, "Business phone number", 32).replace(/[\s().-]/g, "");
  if (!/^(?:\+?1)?[2-9]\d{2}[2-9]\d{6}$/.test(number)) {
    throw new BadRequestException("Enter a valid Canadian or US business phone number.");
  }
  return { mode, forwarding, existingNumber: `+1${number.slice(-10)}` };
}
