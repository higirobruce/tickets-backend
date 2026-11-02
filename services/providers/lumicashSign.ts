import { createHash } from "crypto";

/** Lumicash runs on Bujumbura time; keep zone and offset together so the sandbox checklist changes both at once. */
export const LUMICASH_TZ = "Africa/Bujumbura";
export const LUMICASH_OFFSET = "+0200";

const dateParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: LUMICASH_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Wall-clock parts in Lumicash's zone, independent of the server's own timezone. */
function partsOf(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of dateParts.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** yyyyMMddHHmmss, the CreatedDate form the signature is computed over. */
export function formatSignDate(d: Date): string {
  const p = partsOf(d);
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

/** WCF-style JSON date the cashout body expects. */
export function formatBodyDate(d: Date): string {
  return `/Date(${d.getTime()}${LUMICASH_OFFSET})/`;
}

/** yyyyMMdd, the TransDate verifytransaction expects. */
export function formatTransDate(d: Date): string {
  const p = partsOf(d);
  return `${p.year}${p.month}${p.day}`;
}

/** .NET's Amount.ToString("####"): a whole number with no separators. */
export function formatAmount(n: number): string {
  return String(Math.round(n));
}

/** MD5(Key + CreatedDate + Amount + CustomerMobile + AgentCode + Partner + RequestType + RequestId), lowercase hex. */
export function sign(p: {
  key: string;
  createdAt: Date;
  amount: number;
  customerMobile: string;
  agentCode: string;
  partner: string;
  requestType: 0 | 1;
  requestId: string;
}): string {
  const input =
    p.key + formatSignDate(p.createdAt) + formatAmount(p.amount) + p.customerMobile +
    p.agentCode + p.partner + String(p.requestType) + p.requestId;
  return createHash("md5").update(input).digest("hex");
}

/** Our refIds are UUIDs; Lumicash request ids are plain alphanumerics. */
export function toRequestId(refId: string): string {
  return refId.replace(/-/g, "");
}

/**
 * The spec's samples disagree on whether the 257 prefix is sent, so the sandbox decides via env.
 * Accepts the 8 local digits or the full 257 number (what /payments/start passes), never doubling the prefix.
 */
export function customerMobile(phone: string): string {
  const all = phone.replace(/\D/g, "");
  const digits = all.length === 11 && all.startsWith("257") ? all.slice(3) : all;
  return process.env.LUMICASH_MSISDN_FORMAT === "local" ? digits : `257${digits}`;
}
