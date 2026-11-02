import type { PaymentProvider, StartResult, StatusResult } from "./types";
import { ProviderConfigError } from "./types";
import { customerMobile, formatAmount, formatBodyDate, formatTransDate, sign, toRequestId } from "./lumicashSign";

const REQUIRED = [
  "LUMICASH_BASE_URL",
  "LUMICASH_BASIC_USER",
  "LUMICASH_BASIC_PASS",
  "LUMICASH_PARTNER",
  "LUMICASH_AGENT_MOBILE",
  "LUMICASH_AGENT_CODE",
  "LUMICASH_AGENT_PASSWORD",
  "LUMICASH_SIGN_KEY",
] as const;

const OVER_LIMIT = ["17", "24", "25", "26", "31", "32", "35"];

/**
 * Reason for a documented cashout failure code, or undefined for anything else.
 * Undocumented outcomes stay pending because the wallet may already have been debited.
 */
function failReason(code: string): string | undefined {
  if (code === "10") return "Insufficient balance";
  if (code === "03" || code === "04") return "Wallet not found or locked";
  if (code === "02") return "Lumicash rejected the signature";
  if (OVER_LIMIT.includes(code)) return "Over the wallet's limit";
  if (code === "00") return "Lumicash error";
  return undefined;
}

const isPlainObject = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

interface LumiReply { ok: boolean; httpStatus: number; body: Record<string, any> | undefined }

/** Reads config once when the registry builds the provider, so a missing key fails at startup, not mid-payment. */
function readConfig() {
  for (const key of REQUIRED) {
    if (!process.env[key]) throw new ProviderConfigError(`Lumicash needs ${key}`);
  }
  const env = process.env as Record<(typeof REQUIRED)[number], string>;
  return {
    baseUrl: env.LUMICASH_BASE_URL.replace(/\/$/, ""),
    authorization: "Basic " + Buffer.from(`${env.LUMICASH_BASIC_USER}:${env.LUMICASH_BASIC_PASS}`).toString("base64"),
    partner: env.LUMICASH_PARTNER,
    agentMobile: env.LUMICASH_AGENT_MOBILE,
    agentCode: env.LUMICASH_AGENT_CODE,
    agentPassword: env.LUMICASH_AGENT_PASSWORD,
    signKey: env.LUMICASH_SIGN_KEY,
    serviceId: process.env.LUMICASH_SERVICE_ID || "CHECK_TRANSATION",
    timeoutMs: Number(process.env.LUMICASH_TIMEOUT_MS) || 10000,
  };
}

export function lumicashProvider(): PaymentProvider {
  const cfg = readConfig();

  /**
   * One POST, no retries: a cashout must reach Lumicash at most once per refId.
   * Throws only on network error or timeout; a body that is not a JSON object comes back as undefined.
   */
  async function post(path: string, body: unknown): Promise<LumiReply> {
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: cfg.authorization },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    return { ok: response.ok, httpStatus: response.status, body: isPlainObject(parsed) ? parsed : undefined };
  }

  return {
    id: "lumicash",
    label: "Lumicash",
    currencies: ["BIF"],
    phone: { countryCode: "257", pattern: "^\\d{8}$", hint: "8-digit Lumicash number after +257" },

    async lookup(phone) {
      try {
        const { ok, body: res } = await post("/api/3rd/partner/get-account", { toAccPhone: customerMobile(phone) });
        if (!ok) return { ok: false, reason: "Lumicash could not check this number" };
        if (res?.ResponseCode === "01") return { ok: true, name: JSON.parse(res.ResponseMessage).accountName };
        if (res?.ResponseCode === "05") return { ok: false, reason: "Wallet not found or locked" };
      } catch {
        // Fall through: an unreachable or garbled lookup is not a reason to name the wallet bad.
      }
      return { ok: false, reason: "Lumicash could not check this number" };
    },

    async start(input): Promise<StartResult> {
      const now = new Date();
      const createdDate = now.toISOString();
      const requestId = toRequestId(input.refId);
      const mobile = customerMobile(input.phone || "");
      // The signed amount and the sent amount must be the same integer.
      const amount = Number(formatAmount(input.amount));
      const body = {
        Partner: cfg.partner,
        RequestId: requestId,
        CustomerMobile: mobile,
        AgentMobile: cfg.agentMobile,
        AgentCode: cfg.agentCode,
        Password: cfg.agentPassword,
        Amount: amount,
        CreatedDate: formatBodyDate(now),
        RequestType: 1,
        Description: input.description,
        Signature: sign({
          key: cfg.signKey,
          createdAt: now,
          amount,
          customerMobile: mobile,
          agentCode: cfg.agentCode,
          partner: cfg.partner,
          requestType: 1,
          requestId,
        }),
      };

      // Lumicash may have debited the wallet on any unknown outcome; leave it pending so status() verifies rather than retrying.
      const pending = (raw: Record<string, any>): StartResult => {
        console.warn(`Lumicash cashout outcome unknown for refId ${input.refId}; left pending`);
        return { outcome: "pending", raw };
      };

      let reply: LumiReply;
      try {
        reply = await post("/api/3rd/customer/transaction/partner/cashout-cashin", body);
      } catch (err) {
        return pending({ createdDate, requestId, error: String(err) });
      }

      // Only the response plus what status() needs is kept; the request body (password, signature) never is.
      const raw = { ...(reply.body ?? {}), createdDate, requestId, httpStatus: reply.httpStatus };
      const code = reply.body?.ResponseCode;
      if (!reply.ok || typeof code !== "string") return pending(raw);
      if (code === "01") {
        // Typed as StatusResult so settlement gets amount and payer without a separate verify call.
        const settled: StatusResult = { outcome: "successful", providerRef: reply.body!.RequestId, amount, currency: "BIF", payerPhone: mobile, raw };
        return settled;
      }
      const reason = failReason(code);
      if (!reason) return pending(raw);
      if (code === "02") console.error(`Lumicash rejected the signature for refId ${input.refId}`);
      return { outcome: "failed", reason, raw };
    },

    async status(payment): Promise<StatusResult> {
      const requestId = payment.momoPayload?.requestId ?? toRequestId(payment.refId);
      // A payment without a stored created date falls back to now, so a malformed record still gets checked.
      const created = new Date(payment.momoPayload?.createdDate ?? payment.createdAt ?? Date.now());
      const body = {
        RequestId: requestId,
        PartnerCode: cfg.partner,
        TransCode: payment.providerRef ?? requestId,
        ServiceId: cfg.serviceId,
        TransDate: formatTransDate(created),
        Type: "1",
      };
      // Settlement replaces the stored payload with raw, so carry forward what the next poll needs.
      const keep = { createdDate: created.toISOString(), requestId };
      let reply: LumiReply;
      try {
        reply = await post("/api/3rd/customer/transaction/verifytransaction", body);
      } catch (err) {
        return { outcome: "pending", raw: { error: String(err), ...keep } };
      }
      const res = reply.body;
      const raw = { ...(res ?? {}), httpStatus: reply.httpStatus, ...keep };
      if (!reply.ok || res?.ResponseCode !== "01") return { outcome: "pending", raw };
      if (res.Status === "01") {
        const transAmount = Number(res.TransAmount);
        return {
          outcome: "successful",
          providerRef: res.TransCode ?? payment.providerRef ?? requestId,
          amount: res.TransAmount != null && Number.isFinite(transAmount) ? transAmount : payment.amount,
          currency: "BIF",
          payerPhone: payment.phone,
          raw,
        };
      }
      return { outcome: "failed", reason: res.ResponseMessage, raw };
    },
  };
}
