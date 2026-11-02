import type { PaymentProvider } from "./types";

/** Builds the payload shape the old PAYMENTS_MODE=mock stored, so existing momoPayload consumers keep working. */
function successResult(refId: string, amount: number, currency: string, phone?: string) {
  const providerRef = `MOCK-${refId.slice(0, 8)}`;
  const raw = {
    mock: true,
    status: "SUCCESSFUL",
    amount: String(amount),
    currency,
    payer: { partyIdType: "MSISDN", partyId: phone },
    financialTransactionId: providerRef,
    reason: "Test mode: no payment was taken",
  };
  return { outcome: "successful" as const, providerRef, raw };
}

/** Test-mode provider: every payment succeeds immediately and nothing touches the network. */
export function mockProvider(): PaymentProvider {
  return {
    id: "mock",
    label: "Test mode",
    currencies: [],
    phone: { countryCode: "250", pattern: "^7\\d{8}$", hint: "9 digits starting with 7" },
    start: async ({ refId, amount, currency, phone }) => successResult(refId, amount, currency, phone),
    status: async (payment) => {
      const payload = payment.payload || {};
      const amount = Number(payment.amount ?? payload.amount ?? payment.ticketPackage?.price ?? 0);
      const currency = payment.currency || payload.currency || payment.ticketPackage?.currency || "RWF";
      const phone = payment.phone ?? payload.payer?.partyId;
      const { raw, ...rest } = successResult(payment.refId, amount, currency, phone);
      return { ...rest, amount, currency, payerPhone: phone, raw };
    },
  };
}
