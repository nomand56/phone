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

export type PhonePreferences =
  | { mode: "existing"; existingNumber: string; forwarding: "all" | "missed" | "after_hours" }
  | { mode: "new"; areaCode: string };

export interface Setup {
  name: string;
  profile: Profile | null;
  rules: Rules | null;
  previewedAt: string | null;
  phone: PhonePreferences | null;
  discovery: { answer?: DiscoveryAnswer; missed?: DiscoveryAnswer; capabilities?: Capability[] };
  training: { domain: string; pages: string[]; services: string[]; faqs: string[]; hours: string[] } | null;
  voiceChoice: VoiceChoice | null;
  voiceStatus: "tested" | "skipped" | null;
  selectedNumber: string | null;
  cadence: Cadence | null;
  sandboxCompletedAt: string | null;
}

export type Capability = "messages" | "leads" | "routing" | "questions" | "appointments" | "crm";
export interface DiscoveryAnswer { kind: string; detail?: string }
export type VoiceChoice = "juniper" | "jessica" | "eric" | "enrique";
export type Cadence = "monthly" | "yearly";
export interface TrainingProgress {
  stage: "reading" | "finding" | "extracting" | "preparing";
  domain?: string;
  pages?: string[];
  current?: string;
}
export interface Activation {
  number: string;
  cadence: Cadence;
  state: "checkout" | "provisioning" | "active" | "unavailable";
  subscription: string;
}
