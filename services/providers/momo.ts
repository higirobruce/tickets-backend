import type { PaymentProvider, StatusResult } from "./types";
import { backendUrl } from "../tickets";

const momoBase = () => process.env.MOMO_BASE_URL || "";
const momoHeaders = (token?: string) => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  "Ocp-Apim-Subscription-Key": process.env.MOMO_SUBSCRIPTION_KEY || "",
  "X-Target-Environment": process.env.MOMO_ENVIRONMENT || "",
});

export async function getToken(): Promise<{ access_token: string }> {
  const response = await fetch(`${momoBase()}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${process.env.MOMO_BASIC_AUTH || ""}`,
      "X-Reference-Id": process.env.MOMO_API_USER || "",
      ...momoHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error(`MoMo token request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as { access_token: string };
}

/** Returns MTN's raw status body; the route settles from it directly. */
export async function fetchStatus(refId: string) {
  const { access_token } = await getToken();
  const response = await fetch(`${momoBase()}/collection/v1_0/requesttopay/${refId}`, {
    method: "GET",
    headers: momoHeaders(access_token),
  });
  if (!response.ok) throw new Error(`MoMo responded ${response.status} ${response.statusText}`);
  return response.json();
}

const FAILED = ["FAILED", "REJECTED", "EXPIRED", "TIMEOUT", "CANCELLED"];

/** Currencies are configurable because MTN sandbox and production accept different ones. */
function currencies(): string[] {
  const raw = process.env.MOMO_CURRENCIES;
  const list = (raw || "RWF").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.length ? list : ["RWF"];
}

export function momoProvider(): PaymentProvider {
  return {
    id: "momo",
    label: "MTN MoMo",
    currencies: currencies(),
    phone: { countryCode: "250", pattern: "^7\\d{8}$", hint: "9-digit MTN number after +250, starting with 7" },
    async start({ refId, amount, currency, phone, description }) {
      const { access_token } = await getToken();
      const response = await fetch(`${momoBase()}/collection/v1_0/requesttopay`, {
        method: "POST",
        headers: {
          ...momoHeaders(access_token),
          "X-Reference-Id": refId,
          "X-Callback-Url": `${backendUrl()}/payments/momo/callback`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: String(amount),
          currency,
          externalId: refId,
          payer: { partyIdType: "MSISDN", partyId: phone },
          payerMessage: description,
          payeeNote: description,
        }),
      });
      if (!response.ok) {
        const reason = response.statusText;
        return { outcome: "failed", reason, raw: { status: "FAILED", reason } };
      }
      return { outcome: "pending", raw: {} };
    },
    async status(payment): Promise<StatusResult> {
      const raw = await fetchStatus(payment.refId);
      if (raw.status === "SUCCESSFUL") {
        return {
          outcome: "successful",
          providerRef: raw.financialTransactionId,
          amount: Number(raw.amount),
          currency: raw.currency,
          payerPhone: raw.payer?.partyId,
          raw,
        };
      }
      if (FAILED.includes(raw.status)) return { outcome: "failed", reason: raw.reason, raw };
      return { outcome: "pending", raw };
    },
    callbackRef: (req) => req.body?.externalId || req.body?.referenceId,
  };
}
