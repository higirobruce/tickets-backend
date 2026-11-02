import type { Request } from "express";

export type Outcome = "pending" | "successful" | "failed";

export interface StartInput { refId: string; amount: number; currency: string; phone?: string; description: string }
export interface StartResult { outcome: Outcome; providerRef?: string; reason?: string; raw: any }
export interface StatusResult { outcome: Outcome; providerRef?: string; amount?: number; currency?: string; payerPhone?: string; reason?: string; raw: any }

/** pattern is a RegExp source so it can be sent to the web client as-is. */
export interface PhoneRule { countryCode: string; pattern: string; hint: string }

/** The contract every payment provider implements, so routes never branch on a provider name. */
export interface PaymentProvider {
  id: "momo" | "lumicash" | "stripe" | "mock";
  label: string;
  currencies: string[];
  phone: PhoneRule | null;
  lookup?(phone: string): Promise<{ ok: true; name?: string } | { ok: false; reason: string }>;
  start(input: StartInput): Promise<StartResult>;
  status(payment: any): Promise<StatusResult>;
  callbackRef?(req: Request): string | undefined;
}

/** Thrown for bad provider configuration (e.g. an unknown id in PAYMENT_PROVIDERS). */
export class ProviderConfigError extends Error {}
