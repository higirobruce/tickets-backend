# Multi-Provider Payments (MoMo + Lumicash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell tickets through MTN MoMo (Rwanda, RWF) and Lumicash (Burundi, BIF) from one deployment, chosen by env, behind a provider seam Stripe can join later, with per-currency revenue and per-country SMS.

**Architecture:** A `PaymentProvider` interface (`start` / `status` / optional `lookup` and `callbackRef`) with `momo`, `lumicash` and `mock` implementations and an env-driven registry. A new `/payments` router serves every provider; `/momo/*` stays as a thin compatibility layer for one release. `settlePayment` keeps the exactly-once ticket issue and now consumes a normalised outcome. Tickets gain a normalised `payment` block that reports read first, falling back to the legacy `momoPayload`. SMS becomes a prefix-keyed router.

**Tech Stack:** Node 20+, TypeScript, Express 5, Mongoose 9, vitest + supertest (backend, needs a local MongoDB at `TICKETS_TEST_DB`), Next 15 + Playwright (web). Node's built-in `crypto` for MD5. No new dependencies.

**Spec:** `tickets-backend/docs/superpowers/specs/2026-11-02-multi-provider-payments-design.md` (Lumicash API text beside it: `2026-11-02-lumicash-api-v1.0.txt`).

**Repos:** `tickets-backend` and `tickets-web` are separate git repositories under `eventixr/`. Backend tasks 1–12 commit in `tickets-backend`; web tasks 13–15 commit in `tickets-web`. Work on a branch `feature/multi-provider-payments` in each.

## Global Constraints

- Client-facing payment `status` strings stay exactly `"PENDING"`, `"SUCCESSFUL"`, `"FAILED"` (the web switches on them).
- `PAYMENT_PROVIDERS` comma list; unset ⇒ `momo` (keeps existing deployments working). `PAYMENTS_MODE=mock` ⇒ treated as `PAYMENT_PROVIDERS=mock`.
- Price is never taken from the client on `/payments/start`; it is `package.price × quantity` in `package.currency` from the stored event.
- Lumicash secrets (`LUMICASH_AGENT_PASSWORD`, `LUMICASH_SIGN_KEY`, basic auth) never appear on a record, in a response, or in a log line.
- A Lumicash cashout is sent at most once per `refId`. Never retried.
- Signature: `MD5(Key + CreatedDate("yyyyMMddHHmmss") + Amount("####") + CustomerMobile + AgentCode + Partner + RequestType + RequestId)`, lowercase hex. Dates formatted in `Africa/Bujumbura`, body date as `/Date(<epoch ms>+0200)/`.
- `MOMO_CURRENCIES` default `RWF`; Lumicash currencies fixed `["BIF"]`; mock accepts any currency.
- `Currencies` enum gains `bif = "BIF"`.
- Revenue is always an array `[{ currency, amount, tickets }]`, never a mixed sum.
- SMS: `sendMessage(to, text, from?)` keeps its signature and default export (tests mock `../services/sms`).
- All existing tests keep passing unchanged except the three assertions this plan names explicitly (Task 7 callback URL, Task 10 dashboard totals shape, Task 10 mock dashboard shape).

## Review Focus

Inputs the spec implies but no task's tests exercise directly, most likely to bite first. Each has its pinning test added to the task that owns the code.

1. **Quantity above the mock/Lumicash limit or non-integer** (`quantity: "2.5"`, `0`, `-1`) on `/payments/start` must become `1`–`6` like the panel allows, never a 0 BIF charge. → Task 6.
2. **A Lumicash cashout that returns `01` but `issueTickets` throws** (SMS/QR failure): the record must stay `ISSUING`→`PENDING` with `issueError`, the response must carry `refId`, and a later `GET /payments/:refId` must issue without charging again. → Task 6.
3. **A package whose currency no enabled provider lists** (USD package, `momo` only): `/payments/start` 400s and the panel shows the "not available" copy instead of a broken form. → Task 6 (backend), Task 13 (web).
4. **A buyer number with spaces, a leading 0, or the country code typed in** (`"0 78 812 3456"`, `"+25078…"`): the provider's pattern decides; the backend must reject what the pattern rejects and never silently reformat into another subscriber's number. → Task 6.
5. **An SMS to a prefix with no route** must not fail the purchase and must mark the ticket. → Task 11.

---

## File structure

Backend (`tickets-backend/`):
- `services/providers/types.ts` — interface and result types (new).
- `services/providers/registry.ts` — `enabledProviders()`, `getProvider(id)`, `resetProviders()` (new).
- `services/providers/mock.ts`, `momo.ts`, `lumicash.ts` — implementations (new).
- `services/providers/lumicashSign.ts` — pure signing/date helpers (new).
- `services/payments.ts` — `settlePayment` consumes `StatusResult`; `startPayment()` and `checkPayment()` shared by both routers (modified).
- `routes/routePayments.ts` — `/payments/*` (new).
- `routes/routeMomo.ts` — compat wrappers only (rewritten, smaller).
- `routes/routeAdmin.ts` — `/admin/payments`, verify, per-currency overview (modified).
- `services/dashboard.ts`, `routes/routeTickets.ts`, `routes/routeEvents.ts` — payment fallback and per-currency (modified).
- `models/payments.ts`, `models/tickets.ts`, `models/shared.ts` — fields (modified).
- `services/sms/index.ts` (replaces `services/sms.ts`), `services/sms/africastalking.ts`, `services/sms/log.ts`, `services/sms/templates.ts` (new).
- `services/tickets.ts` — `payment` option, language-aware `ticketSms` (modified).
- `tests/providers.test.ts`, `tests/lumicash.test.ts`, `tests/payments-api.test.ts`, `tests/admin-payments.test.ts`, `tests/revenue.test.ts`, `tests/sms-routing.test.ts` (new); `tests/callback-capacity.test.ts`, `tests/mock-payments.test.ts` (one assertion each).
- `.env.example` (modified).

Web (`tickets-web/app/`):
- `hooks/usePayment.js`, `hooks/useProviders.js` (new), `components/PurchasePanel.js`, `components/EventForm.js`, `organiser/events/[id]/page.js`, `admin/platform/page.js`, `public/images/lumicash.png`, `e2e/smoke.spec.js`.

---

### Task 1: Provider contract and registry

**Files:**
- Create: `services/providers/types.ts`, `services/providers/registry.ts`
- Test: `tests/providers.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type Outcome = "pending" | "successful" | "failed";
  export interface StartInput { refId: string; amount: number; currency: string; phone?: string; description: string }
  export interface StartResult { outcome: Outcome; providerRef?: string; reason?: string; raw: any }
  export interface StatusResult { outcome: Outcome; providerRef?: string; amount?: number; currency?: string; payerPhone?: string; reason?: string; raw: any }
  export interface PhoneRule { countryCode: string; pattern: string; hint: string }   // pattern is a RegExp source so it can be sent to the web
  export interface PaymentProvider {
    id: "momo" | "lumicash" | "stripe" | "mock"; label: string; currencies: string[]; phone: PhoneRule | null;
    lookup?(phone: string): Promise<{ ok: true; name?: string } | { ok: false; reason: string }>;
    start(input: StartInput): Promise<StartResult>;
    status(payment: any): Promise<StatusResult>;
    callbackRef?(req: import("express").Request): string | undefined;
  }
  export class ProviderConfigError extends Error {}
  ```
- Produces (`registry.ts`):
  ```ts
  export function enabledProviderIds(): string[]        // from env, see Global Constraints
  export function enabledProviders(): PaymentProvider[]
  export function getProvider(id: string): PaymentProvider | undefined   // undefined when not enabled
  export function providersForCurrency(currency: string): PaymentProvider[]
  export function resetProviders(): void                // drops the cache; tests call it after changing env
  ```
  Registry builds each provider via a `factories` map `{ momo: () => momoProvider(), lumicash: () => lumicashProvider(), mock: () => mockProvider() }` imported from Tasks 2–5. Until those exist, register `mock` only and add the others in their tasks.

- [ ] **Step 1: Write the failing tests** in `tests/providers.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { enabledProviderIds, enabledProviders, getProvider, providersForCurrency, resetProviders } from "../services/providers/registry";

const env = { ...process.env };
beforeEach(() => resetProviders());
afterEach(() => { process.env = { ...env }; resetProviders(); });

describe("provider registry", () => {
  it("defaults to momo when nothing is set", () => {
    delete process.env.PAYMENT_PROVIDERS; delete process.env.PAYMENTS_MODE;
    expect(enabledProviderIds()).toEqual(["momo"]);
  });
  it("PAYMENTS_MODE=mock is an alias for PAYMENT_PROVIDERS=mock", () => {
    delete process.env.PAYMENT_PROVIDERS; process.env.PAYMENTS_MODE = "mock";
    expect(enabledProviderIds()).toEqual(["mock"]);
  });
  it("parses a comma list, trims, lowercases, ignores blanks", () => {
    process.env.PAYMENT_PROVIDERS = " Momo, lumicash ,, ";
    expect(enabledProviderIds()).toEqual(["momo", "lumicash"]);
  });
  it("an unknown provider id throws ProviderConfigError at first use", () => {
    process.env.PAYMENT_PROVIDERS = "paypal";
    expect(() => enabledProviders()).toThrow(/paypal/);
  });
  it("getProvider returns undefined for a provider that is not enabled", () => {
    process.env.PAYMENT_PROVIDERS = "mock";
    expect(getProvider("momo")).toBeUndefined();
    expect(getProvider("mock")?.id).toBe("mock");
  });
  it("providersForCurrency filters by currency; mock accepts any", () => {
    process.env.PAYMENT_PROVIDERS = "mock";
    expect(providersForCurrency("BIF").map((p) => p.id)).toEqual(["mock"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd tickets-backend && npx vitest run tests/providers.test.ts`
Expected: FAIL, cannot find module `../services/providers/registry`.

- [ ] **Step 3: Implement `types.ts` and `registry.ts`** with the signatures above and a minimal `mock` factory stub (`{ id: "mock", label: "Test mode", currencies: [], phone: null, start, status }` returning successful; Task 2 completes it). `providersForCurrency` treats `currencies.length === 0` as "any".

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/providers.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add services/providers tests/providers.test.ts
git commit -m "feat(payments): provider contract and env-driven registry"
```

---

### Task 2: Mock provider

**Files:**
- Create: `services/providers/mock.ts`
- Modify: `services/providers/registry.ts` (use the real factory)
- Test: `tests/providers.test.ts` (append)

**Interfaces:**
- Produces: `export function mockProvider(): PaymentProvider`. `start` returns `{ outcome: "successful", providerRef: "MOCK-" + refId.slice(0, 8), raw }` where `raw` is the shape today's `mockStatus()` builds (`{ mock: true, status: "SUCCESSFUL", amount: String(amount), currency, payer: { partyIdType: "MSISDN", partyId: phone }, financialTransactionId, reason: "Test mode: no payment was taken" }`) so the existing mock test's `momoPayload` assertions keep passing. `status` returns the same from the stored record. `phone` is `{ countryCode: "250", pattern: "^7\\d{8}$", hint: "9 digits starting with 7" }`. `currencies: []`.

- [ ] **Step 1: Append failing tests**

```ts
it("mock start is successful at once and its raw payload says mock", async () => {
  process.env.PAYMENT_PROVIDERS = "mock";
  const r = await getProvider("mock")!.start({ refId: "abcdef12-0000", amount: 5000, currency: "RWF", phone: "250788123456", description: "x" });
  expect(r.outcome).toBe("successful");
  expect(r.raw).toMatchObject({ mock: true, status: "SUCCESSFUL", amount: "5000", payer: { partyId: "250788123456" } });
  expect(r.providerRef).toBe("MOCK-abcdef12");
});
```

- [ ] **Step 2: Run, expect FAIL** (`npx vitest run tests/providers.test.ts`).
- [ ] **Step 3: Implement `mock.ts`; point the registry factory at it.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(payments): mock provider"`.

---

### Task 3: MoMo provider extracted from the route

**Files:**
- Create: `services/providers/momo.ts`
- Modify: `routes/routeMomo.ts` (import `getToken`, `fetchStatus` from the provider instead of defining them), `services/providers/registry.ts`
- Test: `tests/providers.test.ts` (append); existing `tests/payments.test.ts`, `tests/callback-capacity.test.ts` must stay green.

**Interfaces:**
- Produces: `export function momoProvider(): PaymentProvider` with `id: "momo"`, `label: "MTN MoMo"`, `currencies` from `MOMO_CURRENCIES` (comma list, default `["RWF"]`), `phone: { countryCode: "250", pattern: "^7\\d{8}$", hint: "9-digit MTN number after +250, starting with 7" }`.
  - `start(input)`: `getToken()` then `POST ${MOMO_BASE_URL}/collection/v1_0/requesttopay` with headers exactly as today (`X-Reference-Id: refId`, `X-Callback-Url: ${backendUrl()}/payments/momo/callback`) and body `{ amount: String(input.amount), currency: input.currency, externalId: refId, payer: { partyIdType: "MSISDN", partyId: input.phone }, payerMessage: input.description, payeeNote: input.description }`. Non-2xx ⇒ `{ outcome: "failed", reason: response.statusText, raw: { status: "FAILED", reason } }`, else `{ outcome: "pending", raw: {} }`.
  - `status(payment)`: today's `fetchStatus(refId)`; map `SUCCESSFUL` ⇒ successful (`providerRef = financialTransactionId`, `amount = Number(amount)`, `currency`, `payerPhone = payer.partyId`), `FAILED|REJECTED|EXPIRED|TIMEOUT|CANCELLED` ⇒ failed (`reason = raw.reason`), else pending. `raw` = MTN body. Non-OK response ⇒ throw `Error("MoMo responded <status> <statusText>")` (tests expect a 502 path).
  - `callbackRef(req)`: `req.body.externalId || req.body.referenceId`.
  - Also export `getToken()` (used by `/momo/getToken`).
- Consumes: `backendUrl()` from `services/tickets.ts`.

- [ ] **Step 1: Append failing tests** (fetch is already stubbed globally by `tests/setup.ts`):

```ts
import { fetchMock } from "./setup";
const ok = (body: any, status = 200) => ({ ok: status < 400, status, statusText: "OK", json: async () => body });
it("momo currencies come from MOMO_CURRENCIES, default RWF", () => {
  process.env.PAYMENT_PROVIDERS = "momo"; delete process.env.MOMO_CURRENCIES;
  expect(getProvider("momo")!.currencies).toEqual(["RWF"]);
  resetProviders(); process.env.MOMO_CURRENCIES = "EUR,RWF";
  expect(getProvider("momo")!.currencies).toEqual(["EUR", "RWF"]);
});
it("momo start returns pending and registers the /payments/momo/callback URL", async () => {
  process.env.PAYMENT_PROVIDERS = "momo";
  fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({}, 202));
  const r = await getProvider("momo")!.start({ refId: "ref-1", amount: 5000, currency: "RWF", phone: "250788123456", description: "1 x VIP" });
  expect(r.outcome).toBe("pending");
  const [, init] = fetchMock.mock.calls[1];
  expect(init.headers["X-Callback-Url"]).toBe("http://api.test/payments/momo/callback");
  expect(JSON.parse(init.body)).toMatchObject({ amount: "5000", externalId: "ref-1", payer: { partyId: "250788123456" } });
});
it("momo status maps SUCCESSFUL, REJECTED and PENDING", async () => {
  process.env.PAYMENT_PROVIDERS = "momo";
  const p = getProvider("momo")!;
  fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "SUCCESSFUL", amount: "5000", currency: "RWF", financialTransactionId: "FT1", payer: { partyId: "250788123456" } }));
  expect(await p.status({ refId: "r" })).toMatchObject({ outcome: "successful", providerRef: "FT1", amount: 5000, payerPhone: "250788123456" });
  fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "REJECTED", reason: "PAYER_NOT_FOUND" }));
  expect(await p.status({ refId: "r" })).toMatchObject({ outcome: "failed", reason: "PAYER_NOT_FOUND" });
  fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "PENDING" }));
  expect((await p.status({ refId: "r" })).outcome).toBe("pending");
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `momo.ts`**; move `getToken`/`fetchStatus`/`momoHeaders` there; have `routes/routeMomo.ts` import `getToken` from it. Do not change the route's behaviour yet (Task 7 does).
- [ ] **Step 4: Run the whole suite, expect PASS** — `npx vitest run`.
- [ ] **Step 5: Commit** — `git add -A services/providers routes/routeMomo.ts tests && git commit -m "feat(payments): MoMo as a provider module"`.

---

### Task 4: Normalised settlement and the ticket `payment` block

**Files:**
- Modify: `models/payments.ts`, `models/tickets.ts`, `models/shared.ts`, `services/payments.ts`, `services/tickets.ts:51-82`, `routes/routeMomo.ts` (call sites of `settlePayment`)
- Test: `tests/payments-api.test.ts` (new file, first describe block)

**Interfaces:**
- `models/shared.ts`: `Currencies.bif = "BIF"`.
- `models/payments.ts` adds `provider: { type: String, default: "momo" }`, `providerRef: String`, `amount: Number`, `currency: String`, `phone: String`; index `{ provider: 1, providerRef: 1 }`.
- `models/tickets.ts` adds `payment: { provider: String, ref: String, amount: Number, currency: String, phone: String }`.
- `services/tickets.ts`: `IssueOptions.payment?: { provider: string; ref?: string; amount?: number; currency?: string; phone?: string }`; stored on the ticket; `phone` for SMS resolves `options.phone ?? options.payment?.phone ?? phoneFromPayload(options.momoPayload)`.
- `services/payments.ts`:
  ```ts
  export async function settlePayment(payment: any, result: StatusResult): Promise<{ code: number; body: any }>
  ```
  `failed` ⇒ set `status: FAILED`, `momoPayload: result.raw`, release seats, body `{ ...result.raw, status: "FAILED", reason: result.reason }`, code 200. `pending` ⇒ store raw, body `{ ...raw, status: "PENDING" }`. `successful` ⇒ claim as today; `issueTickets({ ..., momoPayload: result.raw, momoRef: refId, phone: result.payerPhone ?? claimed.phone, payment: { provider: claimed.provider, ref: result.providerRef, amount: result.amount ?? claimed.amount, currency: result.currency ?? claimed.currency, phone: result.payerPhone ?? claimed.phone } })`; on success set `providerRef`; body `{ ...raw, status: "SUCCESSFUL", tickets }`. Issue failure ⇒ code 500, body `{ errorMessage, refId }` and record back to `PENDING` with `issueError` (unchanged rule).
  - Remove `mockPayments()`/`mockStatus()`; the mock provider replaces them (keep the exports as thin shims until Task 7 deletes their last callers).
- `routes/routeMomo.ts` adapts its two `settlePayment` calls to pass a `StatusResult` built with the momo provider's mapping (temporary; Task 7 rewrites the file).

- [ ] **Step 1: Write failing tests** in `tests/payments-api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { settlePayment } from "../services/payments";
import { paymentModel } from "../models/payments";
import { ticketModel } from "../models/tickets";
import { seedEvent } from "./helpers";
vi.mock("../services/sms", () => ({ default: vi.fn() }));

describe("settlePayment with a normalised result", () => {
  it("successful issues once and stores the payment block on the ticket", async () => {
    const event = await seedEvent();
    const p = await paymentModel.create({ refId: "r1", provider: "lumicash", amount: 7000, currency: "BIF", phone: "25768191919", event: event._id, ticketPackage: event.packages[0], quantity: 1 });
    const first = await settlePayment(p, { outcome: "successful", providerRef: "LC-1", raw: { ResponseCode: "01" } });
    expect(first.code).toBe(200); expect(first.body.status).toBe("SUCCESSFUL"); expect(first.body.tickets).toHaveLength(1);
    const again = await settlePayment(await paymentModel.findOne({ refId: "r1" }), { outcome: "successful", providerRef: "LC-1", raw: {} });
    expect(again.body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
    const t: any = await ticketModel.findOne();
    expect(t.payment).toMatchObject({ provider: "lumicash", ref: "LC-1", amount: 7000, currency: "BIF", phone: "25768191919" });
    expect((await paymentModel.findOne({ refId: "r1" }))!.providerRef).toBe("LC-1");
  });
  it("failed marks the record FAILED with the reason and releases seats", async () => {
    const event = await seedEvent({ packages: [{ title: "Regular", price: 5000, currency: "RWF", capacity: 2, sold: 1 }] });
    const pkg: any = event.packages[0];
    const p = await paymentModel.create({ refId: "r2", provider: "lumicash", event: event._id, ticketPackage: pkg, quantity: 1, reserved: true });
    const r = await settlePayment(p, { outcome: "failed", reason: "Insufficient balance", raw: { ResponseCode: "10" } });
    expect(r.body).toMatchObject({ status: "FAILED", reason: "Insufficient balance" });
    expect((await paymentModel.findOne({ refId: "r2" }))!.status).toBe("FAILED");
    expect((await ticketModel.countDocuments())).toBe(0);
    const fresh: any = await (await import("../models/events")).eventModel.findById(event._id);
    expect(fresh.packages[0].sold).toBe(0);
  });
  it("pending stores the raw payload and issues nothing", async () => {
    const p = await paymentModel.create({ refId: "r3", provider: "momo" });
    const r = await settlePayment(p, { outcome: "pending", raw: { status: "PENDING" } });
    expect(r.body.status).toBe("PENDING");
    expect(await ticketModel.countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`settlePayment` ignores `outcome`).
- [ ] **Step 3: Implement** the model fields and the new `settlePayment`; adapt `routeMomo.ts` call sites so the legacy suite still passes.
- [ ] **Step 4: Run the whole suite, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(payments): normalised settlement outcome and ticket payment block"`.

---

### Task 5: Lumicash signing helpers and provider

**Files:**
- Create: `services/providers/lumicashSign.ts`, `services/providers/lumicash.ts`
- Modify: `services/providers/registry.ts` (factory)
- Test: `tests/lumicash.test.ts`

**Interfaces:**
- `lumicashSign.ts`:
  ```ts
  export const LUMICASH_TZ = "Africa/Bujumbura"; export const LUMICASH_OFFSET = "+0200";
  export function formatSignDate(d: Date): string          // yyyyMMddHHmmss in LUMICASH_TZ
  export function formatBodyDate(d: Date): string          // `/Date(${d.getTime()}${LUMICASH_OFFSET})/`
  export function formatTransDate(d: Date): string         // yyyyMMdd in LUMICASH_TZ
  export function formatAmount(n: number): string          // integer, no separators: "5000"
  export function sign(p: { key: string; createdAt: Date; amount: number; customerMobile: string; agentCode: string; partner: string; requestType: 0 | 1; requestId: string }): string
  export function toRequestId(refId: string): string       // hyphens removed
  export function customerMobile(local9: string): string   // "257" + digits when LUMICASH_MSISDN_FORMAT!=="local", else digits
  ```
- `lumicash.ts`: `export function lumicashProvider(): PaymentProvider` with `id: "lumicash"`, `label: "Lumicash"`, `currencies: ["BIF"]`, `phone: { countryCode: "257", pattern: "^\\d{8}$", hint: "8-digit Lumicash number after +257" }`. Required env (throw `ProviderConfigError` naming the missing key): `LUMICASH_BASE_URL, LUMICASH_BASIC_USER, LUMICASH_BASIC_PASS, LUMICASH_PARTNER, LUMICASH_AGENT_MOBILE, LUMICASH_AGENT_CODE, LUMICASH_AGENT_PASSWORD, LUMICASH_SIGN_KEY`; optional `LUMICASH_SERVICE_ID` (default `CHECK_TRANSATION`), `LUMICASH_MSISDN_FORMAT` (default `international`), `LUMICASH_TIMEOUT_MS` (default `10000`).
  - Paths (relative to base URL): `/api/3rd/partner/get-account`, `/api/3rd/customer/transaction/partner/cashout-cashin`, `/api/3rd/customer/transaction/verifytransaction`. Headers: `Content-Type: application/json`, `Authorization: Basic base64(user:pass)`. Use global `fetch` with `AbortSignal.timeout(LUMICASH_TIMEOUT_MS)`.
  - `lookup(phone)`: `{ toAccPhone: customerMobile(phone) }`; `01` ⇒ `{ ok: true, name: JSON.parse(ResponseMessage).accountName }`; `05` ⇒ `{ ok: false, reason: "Wallet not found or locked" }`; else `{ ok: false, reason: "Lumicash could not check this number" }`.
  - `start(input)`: body `{ Partner, RequestId: toRequestId(refId), CustomerMobile, AgentMobile, AgentCode, Password, Amount: input.amount, CreatedDate: formatBodyDate(now), RequestType: 1, Description: input.description, Signature: sign(...) }`. Store nothing secret. Mapping of `ResponseCode`: `01` ⇒ successful (`providerRef = body.RequestId`, `amount = input.amount`, `currency = "BIF"`, `payerPhone = CustomerMobile`); `10` ⇒ failed "Insufficient balance"; `03`/`04` ⇒ failed "Wallet not found or locked"; `02` ⇒ failed "Lumicash rejected the signature" and `console.error` with refId only; `17,24,25,26,31,32,35` ⇒ failed "Over the wallet's limit"; anything else ⇒ failed "Lumicash error". `raw` = response body plus `{ createdDate: ISO string of now, requestId }` (needed by `status`). Fetch throw / timeout / non-JSON ⇒ `{ outcome: "pending", raw: { createdDate, requestId, error: String(err) } }`.
  - `status(payment)`: body `{ RequestId: payment.momoPayload?.requestId ?? toRequestId(payment.refId), PartnerCode, TransCode: payment.providerRef ?? that RequestId, ServiceId, TransDate: formatTransDate(new Date(payment.momoPayload?.createdDate ?? payment.createdAt)), Type: "1" }`. `ResponseCode === "01"` and `Status === "01"` ⇒ successful (`providerRef = TransCode`, `amount = TransAmount`, `currency: "BIF"`, `payerPhone = payment.phone`); `ResponseCode === "01"` otherwise ⇒ failed (`reason = ResponseMessage`); any other code or error ⇒ pending.

- [ ] **Step 1: Write failing tests** in `tests/lumicash.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sign, formatSignDate, formatBodyDate, formatTransDate, formatAmount, toRequestId, customerMobile } from "../services/providers/lumicashSign";
import { getProvider, resetProviders } from "../services/providers/registry";
import { fetchMock } from "./setup";

const ok = (body: any) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
const env = { ...process.env };
const LUMI = { PAYMENT_PROVIDERS: "lumicash", LUMICASH_BASE_URL: "http://lumi.test/ewapi", LUMICASH_BASIC_USER: "u", LUMICASH_BASIC_PASS: "p", LUMICASH_PARTNER: "EVENTIXR", LUMICASH_AGENT_MOBILE: "25762479782", LUMICASH_AGENT_CODE: "89503", LUMICASH_AGENT_PASSWORD: "agent-pw", LUMICASH_SIGN_KEY: "secret" };
beforeEach(() => { Object.assign(process.env, LUMI); resetProviders(); });
afterEach(() => { process.env = { ...env }; resetProviders(); });

describe("lumicash signing", () => {
  it("formats the signature date in Bujumbura time", () => {
    expect(formatSignDate(new Date("2026-11-02T10:00:00Z"))).toBe("20261102120000");
    expect(formatTransDate(new Date("2026-11-02T22:30:00Z"))).toBe("20261103");
    expect(formatBodyDate(new Date(1664520885000))).toBe("/Date(1664520885000+0200)/");
    expect(formatAmount(5000)).toBe("5000"); expect(formatAmount(1000.0)).toBe("1000");
  });
  it("reproduces a hand-computed MD5", () => {
    // md5("secret" + "20261102120000" + "5000" + "25768191919" + "89503" + "EVENTIXR" + "1" + "abc123")
    expect(sign({ key: "secret", createdAt: new Date("2026-11-02T10:00:00Z"), amount: 5000, customerMobile: "25768191919", agentCode: "89503", partner: "EVENTIXR", requestType: 1, requestId: "abc123" }))
      .toBe("d8e9ab2627e1283d1a5adbec3cf397ec");
  });
  it("request id drops hyphens; mobile gains 257 unless LUMICASH_MSISDN_FORMAT=local", () => {
    expect(toRequestId("3f2a-77")).toBe("3f2a77");
    expect(customerMobile("68191919")).toBe("25768191919");
    process.env.LUMICASH_MSISDN_FORMAT = "local";
    expect(customerMobile("68191919")).toBe("68191919");
  });
});

describe("lumicash provider", () => {
  it("fails fast when a required env value is missing", () => {
    delete process.env.LUMICASH_SIGN_KEY; resetProviders();
    expect(() => getProvider("lumicash")).toThrow(/LUMICASH_SIGN_KEY/);
  });
  it("lookup returns the holder name on 01 and a reason on 05", async () => {
    const p = getProvider("lumicash")!;
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", ResponseMessage: JSON.stringify({ accountName: "Bui Duc Truyen", accountId: "1" }) }));
    expect(await p.lookup!("68191919")).toEqual({ ok: true, name: "Bui Duc Truyen" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://lumi.test/ewapi/api/3rd/partner/get-account");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("u:p").toString("base64"));
    expect(JSON.parse(init.body)).toEqual({ toAccPhone: "25768191919" });
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "05", ResponseMessage: "locked" }));
    expect(await p.lookup!("68191919")).toEqual({ ok: false, reason: "Wallet not found or locked" });
  });
  it("start sends a signed cashout and maps 01 to successful", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", ResponseMessage: "Transaction successful", RequestId: "22010512947928" }));
    const r = await getProvider("lumicash")!.start({ refId: "3f2a-77", amount: 7000, currency: "BIF", phone: "68191919", description: "1 x VIP" });
    expect(r).toMatchObject({ outcome: "successful", providerRef: "22010512947928", amount: 7000, currency: "BIF", payerPhone: "25768191919" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ Partner: "EVENTIXR", RequestId: "3f2a77", CustomerMobile: "25768191919", AgentMobile: "25762479782", AgentCode: "89503", Password: "agent-pw", Amount: 7000, RequestType: 1 });
    expect(body.Signature).toMatch(/^[0-9a-f]{32}$/);
    expect(body.CreatedDate).toMatch(/^\/Date\(\d+\+0200\)\/$/);
    expect(JSON.stringify(r.raw)).not.toContain("agent-pw"); expect(JSON.stringify(r.raw)).not.toContain("secret");
  });
  it("maps 10, 03, 02, 25 and 00 to failed with the spec's reasons", async () => {
    const p = getProvider("lumicash")!; const go = () => p.start({ refId: "x", amount: 1, currency: "BIF", phone: "68191919", description: "" });
    for (const [code, reason] of [["10", "Insufficient balance"], ["03", "Wallet not found or locked"], ["02", "Lumicash rejected the signature"], ["25", "Over the wallet's limit"], ["00", "Lumicash error"]]) {
      fetchMock.mockResolvedValueOnce(ok({ ResponseCode: code, ResponseMessage: "m" }));
      expect(await go()).toMatchObject({ outcome: "failed", reason });
    }
  });
  it("a network error leaves the payment pending, never retries", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const r = await getProvider("lumicash")!.start({ refId: "x", amount: 1, currency: "BIF", phone: "68191919", description: "" });
    expect(r.outcome).toBe("pending"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("status verifies with TransDate from the stored created date and maps Status 01", async () => {
    const p = getProvider("lumicash")!;
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", ResponseMessage: "Transaction is Successful", Status: "01", TransCode: "2628", TransAmount: 7000, TransFee: 50 }));
    const r = await p.status({ refId: "3f2a-77", providerRef: "2628", phone: "25768191919", momoPayload: { createdDate: "2026-11-02T22:30:00.000Z", requestId: "3f2a77" } });
    expect(r).toMatchObject({ outcome: "successful", providerRef: "2628", amount: 7000 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ RequestId: "3f2a77", PartnerCode: "EVENTIXR", TransCode: "2628", ServiceId: "CHECK_TRANSATION", TransDate: "20261103", Type: "1" });
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", Status: "02", ResponseMessage: "Failed" }));
    expect((await p.status({ refId: "x", momoPayload: {} })).outcome).toBe("failed");
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "999" }));
    expect((await p.status({ refId: "x", momoPayload: {} })).outcome).toBe("pending");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `lumicashSign.ts` then `lumicash.ts`**; register the factory. Use `Intl.DateTimeFormat("en-GB", { timeZone: LUMICASH_TZ, ...parts })` for the date parts; `crypto.createHash("md5")`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add services/providers tests/lumicash.test.ts && git commit -m "feat(payments): Lumicash provider with signed cashout, lookup and verify"`.

---

### Task 6: `/payments` router with server-side pricing

**Files:**
- Create: `routes/routePayments.ts`
- Modify: `services/payments.ts` (add `startPayment`, `checkPayment`), `app.ts:52-61` (mount `/payments` with `limiter(60)`, lookup with `limiter(10, 1)`)
- Test: `tests/payments-api.test.ts` (append)

**Interfaces:**
- `services/payments.ts`:
  ```ts
  export interface StartRequest { provider: string; eventId: string; packageId: string; quantity: unknown; phone: string; buyer?: { name?: string; email?: string } }
  export async function startPayment(r: StartRequest): Promise<{ code: number; body: any }>
  export async function checkPayment(refId: string): Promise<{ code: number; body: any }>   // 404 when unknown
  export function normaliseQuantity(q: unknown): number   // floor(Number) clamped to 1..6
  ```
  `startPayment`: provider via `getProvider` (400 `"Payment method <id> is not available"`), event + package by `packageId` (400 `"Choose a ticket package"`), currency check (400 `"<label> cannot take <CUR>"`), phone check against `provider.phone.pattern` on the digits the client sent (400 `provider.phone.hint`), then `releaseStalePayments()`, `reserveCapacity` (409 as today), create record `{ refId: randomUUID(), provider, amount: price×qty, currency, phone: countryCode + digits, event, ticketPackage: pkg, quantity, reserved, buyer, payload: { description } }`, call `provider.start({ refId, amount, currency, phone: countryCode + digits, description: \`${qty} x ${pkg.title} for ${event.title}\` })`. Outcome `successful` ⇒ `settlePayment` ⇒ `{ code: 200, body: { refId, ...settled.body } }` (a 500 from settle passes through with `refId`). `pending` ⇒ `202 { refId, status: "PENDING", mock?: true for mock }`. `failed` ⇒ settle ⇒ `402 { refId, ...body }`.
  `checkPayment`: today's `resolveAndSettle` with `getProvider(payment.provider)` (a record whose provider is no longer enabled ⇒ 409 `"Payment method no longer available"`); `SUCCESSFUL` records answer without calling the provider.
  `releaseStalePayments()` (modified): for a stale record whose provider is `lumicash`, call `provider.status` first; expire and release only when the outcome is `failed`; a `pending` or thrown verify leaves the record untouched (it stays on the admin list). Other providers keep today's behaviour. Pin it with this test in the same describe block:

```ts
it("a stale Lumicash payment is only expired after verify says failed", async () => {
  Object.assign(process.env, LUMI_ENV); resetProviders();
  const event = await bif(); const pkg: any = event.packages[0];
  const old = new Date(Date.now() - 31 * 60 * 1000);
  const mk = (refId: string) => paymentModel.create({ refId, provider: "lumicash", status: "PENDING", reserved: true, event: event._id, ticketPackage: pkg, quantity: 1, momoPayload: { requestId: refId, createdDate: old.toISOString() }, createdAt: old });
  await mk("verify-unreachable"); await mk("verify-failed");
  fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));                                  // first record
  lumiOk({ ResponseCode: "01", Status: "02", ResponseMessage: "Transaction failed" });        // second record
  const { releaseStalePayments } = await import("../services/payments");
  await releaseStalePayments();
  expect((await paymentModel.findOne({ refId: "verify-unreachable" }))!.status).toBe("PENDING");
  expect((await paymentModel.findOne({ refId: "verify-failed" }))!.status).toBe("EXPIRED");
});
```
  (Set `createdAt` with a `paymentModel.updateOne` after create if Mongoose overwrites the supplied value.)
- `routes/routePayments.ts`: `GET /providers` ⇒ `enabledProviders().map(({ id, label, currencies, phone }) => ({ id, label, currencies, phone }))`; `POST /start`; `GET /:refId`; `POST|PUT /:provider/callback` (404 unknown provider or ref; re-reads via `checkPayment`; responds `{ received: true, status }`); `POST /lookup` (400 when the provider has no `lookup`).

- [ ] **Step 1: Append failing tests** (same file; `vi.mock("../services/sms")` already there):

```ts
import { afterEach } from "vitest";
import { api, seedEvent } from "./helpers";
import { fetchMock } from "./setup";
import { eventModel } from "../models/events";
import { resetProviders } from "../services/providers/registry";
import { LUMI_ENV } from "./lumicashEnv";
const ok = (body: any, status = 200) => ({ ok: status < 400, status, statusText: "OK", json: async () => body });
const envSnap = { ...process.env };
afterEach(() => { process.env = { ...envSnap }; resetProviders(); });

describe("POST /payments/start", () => {
  const bif = () => seedEvent({ title: "Bujumbura Live", packages: [{ title: "VIP", price: 7000, currency: "BIF", capacity: 5 }] });
  const lumiOk = (body: any) => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => body });

  it("lists only enabled providers", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const res = await api().get("/payments/providers");
    expect(res.body).toEqual([{ id: "mock", label: "Test mode", currencies: [], phone: { countryCode: "250", pattern: "^7\\d{8}$", hint: expect.any(String) } }]);
  });
  it("charges the stored price, not the client's, and completes a Lumicash sale at once", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();           // same block as tests/lumicash.test.ts; export it from a tests/lumicashEnv.ts helper
    const event = await bif(); const pkg: any = event.packages[0];
    lumiOk({ ResponseCode: "01", RequestId: "LC1" });
    const res = await api().post("/payments/start").send({ provider: "lumicash", eventId: String(event._id), packageId: String(pkg._id), quantity: 2, phone: "68191919", price: 1 });
    expect(res.status).toBe(200); expect(res.body.status).toBe("SUCCESSFUL"); expect(res.body.tickets).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).Amount).toBe(14000);
    const t: any = await ticketModel.findOne();
    expect(t.payment).toMatchObject({ provider: "lumicash", amount: 14000, currency: "BIF", phone: "25768191919", ref: "LC1" });
  });
  it("a failed cashout answers 402 with the reason and frees the seats", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    const event = await bif(); const pkg: any = event.packages[0];
    lumiOk({ ResponseCode: "10" });
    const res = await api().post("/payments/start").send({ provider: "lumicash", eventId: String(event._id), packageId: String(pkg._id), quantity: 1, phone: "68191919" });
    expect(res.status).toBe(402); expect(res.body).toMatchObject({ status: "FAILED", reason: "Insufficient balance" });
    expect((await eventModel.findById(event._id))!.packages[0].sold).toBe(0);
  });
  it("rejects a disabled provider, a currency mismatch and a bad phone", async () => {
    process.env.PAYMENT_PROVIDERS = "momo"; resetProviders();
    const bifEvent = await bif(); const rwf = await seedEvent();
    expect((await api().post("/payments/start").send({ provider: "lumicash", eventId: String(rwf._id), packageId: String(rwf.packages[0]._id), phone: "788123456" })).status).toBe(400);
    expect((await api().post("/payments/start").send({ provider: "momo", eventId: String(bifEvent._id), packageId: String(bifEvent.packages[0]._id), phone: "788123456" })).status).toBe(400);
    for (const phone of ["0788123456", "+250788123456", "78 812 3456", "688123456"]) {
      expect((await api().post("/payments/start").send({ provider: "momo", eventId: String(rwf._id), packageId: String(rwf.packages[0]._id), phone })).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("quantity is clamped to 1..6 and never zero", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    for (const [q, expected] of [["2.5", 2], [0, 1], [-1, 1], [99, 6], ["abc", 1]] as const) {
      const res = await api().post("/payments/start").send({ provider: "mock", eventId: String(event._id), packageId: String(pkg._id), quantity: q, phone: "788123456" });
      expect(res.body.tickets).toHaveLength(expected);
    }
  });
  it("a mock purchase is SUCCESSFUL on the first response and flagged as a test", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    const res = await api().post("/payments/start").send({ provider: "mock", eventId: String(event._id), packageId: String(pkg._id), phone: "788123456" });
    expect(res.status).toBe(200); expect(res.body.mock).toBe(true); expect(res.body.refId).toBeTypeOf("string");
    expect((await api().get(`/payments/${res.body.refId}`)).body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("momo start is 202 pending and the momo callback settles once", async () => {
    process.env.PAYMENT_PROVIDERS = "momo"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({}, 202));
    const start = await api().post("/payments/start").send({ provider: "momo", eventId: String(event._id), packageId: String(pkg._id), phone: "788123456" });
    expect(start.status).toBe(202);
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "SUCCESSFUL", amount: "5000", currency: "RWF", financialTransactionId: "FT1", payer: { partyId: "250788123456" } }));
    const cb = await api().post("/payments/momo/callback").send({ externalId: start.body.refId, status: "SUCCESSFUL" });
    expect(cb.status).toBe(200); expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("when the provider says paid but issuing throws, the record stays recoverable", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    const tickets = await import("../services/tickets");
    const spy = vi.spyOn(tickets, "issueTickets").mockRejectedValueOnce(new Error("QR down"));
    const res = await api().post("/payments/start").send({ provider: "mock", eventId: String(event._id), packageId: String(pkg._id), phone: "788123456" });
    expect(res.status).toBe(500); expect(res.body.refId).toBeTypeOf("string");
    expect((await paymentModel.findOne({ refId: res.body.refId }))!.status).toBe("PENDING");
    spy.mockRestore();
    expect((await api().get(`/payments/${res.body.refId}`)).body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("lookup proxies the provider and 400s for providers without lookup", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    lumiOk({ ResponseCode: "01", ResponseMessage: JSON.stringify({ accountName: "A B" }) });
    expect((await api().post("/payments/lookup").send({ provider: "lumicash", phone: "68191919" })).body).toEqual({ ok: true, name: "A B" });
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    expect((await api().post("/payments/lookup").send({ provider: "mock", phone: "788123456" })).status).toBe(400);
  });
});
```

Note for the implementer: `issueTickets` is called through the module namespace in `services/payments.ts` (`import * as tickets from "./tickets"` then `tickets.issueTickets(...)`) so the spy above takes effect.

- [ ] **Step 2: Run, expect FAIL** (404 on `/payments/*`).
- [ ] **Step 3: Implement** `startPayment`, `checkPayment`, `normaliseQuantity`, the router, the mounts in `app.ts`. Create `tests/lumicashEnv.ts` exporting `LUMI_ENV` and use it in `tests/lumicash.test.ts` too.
- [ ] **Step 4: Run the whole suite, expect PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(payments): /payments API with server-side pricing for every provider"`.

---

### Task 7: `/momo/*` compatibility layer

**Files:**
- Rewrite: `routes/routeMomo.ts`
- Modify: `tests/callback-capacity.test.ts:29` (callback URL assertion), `services/payments.ts` (delete `mockPayments`/`mockStatus` shims)
- Test: existing `tests/payments.test.ts`, `tests/mock-payments.test.ts`, `tests/callback-capacity.test.ts`

**Interfaces:**
- `POST /momo/requestToPay` keeps its body contract (client amount, `payer.partyId`, `eventId`, `ticketPackage` possibly without `_id`, `quantity`, `buyer`). It builds the record itself exactly as today (`amount: Number(amount)`, `currency`, `phone: payer.partyId`, `provider: getProvider("momo") ? "momo" : "mock"` when only mock is enabled) and calls `provider.start` then `settlePayment` on a failed outcome; responds `202 { message, refId }` (`{ message: "Accepted (test mode, no payment taken)", refId, mock: true }` for mock). It must not reject a package without `_id`.
- `GET /momo/statusOfRequest/:refId` ⇒ `checkPayment(refId)`, keeping the "unknown ref creates a record from `title/price/currency` query unless mock" branch.
- `POST|PUT /momo/callback` ⇒ same handler as `/payments/momo/callback`.
- `/momo/getToken`, `/momo/sendSMS` unchanged.

- [ ] **Step 1: Change the one assertion** in `tests/callback-capacity.test.ts` to `expect(init.headers["X-Callback-Url"]).toBe("http://api.test/payments/momo/callback")`. Run `npx vitest run tests/callback-capacity.test.ts` — it already passes after Task 3; this step only records the new contract.
- [ ] **Step 2: Rewrite `routes/routeMomo.ts`** as wrappers over `services/payments.ts` and the momo/mock providers. Delete `mockPayments`/`mockStatus`.
- [ ] **Step 3: Run the whole suite** — `npx vitest run`. Expected: all green, including the three legacy payment files unchanged apart from Step 1.
- [ ] **Step 4: Commit** — `git commit -am "refactor(payments): /momo routes delegate to the provider layer"`.

---

### Task 8: Admin payments list and verify

**Files:**
- Modify: `routes/routeAdmin.ts`
- Test: `tests/admin-payments.test.ts`

**Interfaces:**
- `GET /admin/payments?status=PENDING&provider=lumicash&limit=50` ⇒ `{ payments: [{ refId, provider, providerRef, status, amount, currency, phone, event, quantity, issueError, createdAt, updatedAt }] }` newest first, default limit 50, max 200. Never includes `payload`/`momoPayload`.
- `POST /admin/payments/:refId/verify` ⇒ `checkPayment(refId)` result (`code`, `body`). 404 for unknown.
- Both behind the existing `ensureUserAuthorized, requireRole("admin")` on the router.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { api, registerAndLogin, seedEvent, registerOrganiser } from "./helpers";
import { paymentModel } from "../models/payments";
import { ticketModel } from "../models/tickets";
import { fetchMock } from "./setup";
import { resetProviders } from "../services/providers/registry";
import { LUMI_ENV } from "./lumicashEnv";
vi.mock("../services/sms", () => ({ default: vi.fn() }));

describe("admin payments", () => {
  it("lists pending Lumicash payments without secrets and verify issues the ticket", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    const { token } = await registerAndLogin();            // first account is admin
    const event = await seedEvent({ packages: [{ title: "VIP", price: 7000, currency: "BIF" }] });
    await paymentModel.create({ refId: "stuck", provider: "lumicash", status: "PENDING", amount: 7000, currency: "BIF", phone: "25768191919", event: event._id, ticketPackage: event.packages[0], quantity: 1, momoPayload: { requestId: "stuck", createdDate: new Date().toISOString(), Password: "must-not-leak" } });
    const list = await api().get("/admin/payments?status=PENDING&provider=lumicash").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200); expect(list.body.payments).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("must-not-leak");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => ({ ResponseCode: "01", Status: "01", TransCode: "T1", TransAmount: 7000 }) });
    const v = await api().post("/admin/payments/stuck/verify").set("Authorization", `Bearer ${token}`);
    expect(v.status).toBe(200); expect(v.body.status).toBe("SUCCESSFUL");
    expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("organisers cannot see payments", async () => {
    const { token } = await registerOrganiser();
    expect((await api().get("/admin/payments").set("Authorization", `Bearer ${token}`)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run, expect FAIL (404).**
- [ ] **Step 3: Implement** the two routes.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add routes/routeAdmin.ts tests/admin-payments.test.ts && git commit -m "feat(admin): list and verify payments"`.

---

### Task 9: Revenue per currency and payment fallbacks in reports

**Files:**
- Modify: `services/dashboard.ts`, `routes/routeAdmin.ts:11-53`, `routes/routeTickets.ts:193-215`, `routes/routeEvents.ts:102-140`
- Modify (one assertion): `tests/mock-payments.test.ts:84`
- Test: `tests/revenue.test.ts`

**Interfaces:**
- Shared Mongo expressions in a new `services/reporting.ts`:
  ```ts
  export const paidAmount: any   // $ifNull: ["$payment.amount", $convert(momoPayload.amount)]  and 0 when complimentary
  export const paidCurrency: any // $ifNull: ["$payment.currency", "$ticketPackage.currency", "RWF"]
  export const isPaid: any       // has payment or momoPayload, and not complimentary
  export const payerPhone: any   // $ifNull: ["$payment.phone", "$momoPayload.payer.partyId"]
  export type Revenue = { currency: string; amount: number; tickets: number }[]
  ```
- `eventDashboard` returns `totals: { tickets, paid, consumed, pending, revenue: Revenue }`, `byPackage: [{ title, currency, count, revenue, consumed }]` (grouped by title + currency), `recent` selected with `payment` and `momoPayload.amount momoPayload.payer.partyId`.
- `/admin/overview` returns `totals.revenue: Revenue`, each organiser row `revenue: Revenue`.
- `getTicketsSummary` groups by `{ title, currency }` and returns `{ title, currency, count, total }`.
- Attendee CSV `phone` and `amount` columns and broadcast recipients use `t.payment?.phone ?? t.momoPayload?.payer?.partyId` and `t.payment?.amount ?? t.momoPayload?.amount`.

- [ ] **Step 1: Write failing tests** in `tests/revenue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { api, registerOrganiser, eventBody, registerAndLogin } from "./helpers";
import { ticketModel } from "../models/tickets";
vi.mock("../services/sms", () => ({ default: vi.fn() }));

async function eventWithMixedSales() {
  const owner = await registerOrganiser();
  const { body: event } = await api().post("/events").set("Authorization", `Bearer ${owner.token}`)
    .send(eventBody({ packages: [{ title: "Regular", price: 5000, currency: "RWF" }, { title: "VIP", price: 7000, currency: "BIF" }] }));
  await ticketModel.create({ number: 10000001, qrCode: "x", event: event._id, ticketPackage: event.packages[0], momoPayload: { amount: "5000", payer: { partyId: "250788123456" } } });
  await ticketModel.create({ number: 10000002, qrCode: "x", event: event._id, ticketPackage: event.packages[1], payment: { provider: "lumicash", amount: 7000, currency: "BIF", phone: "25768191919" } });
  await ticketModel.create({ number: 10000003, qrCode: "x", event: event._id, ticketPackage: event.packages[1], payment: { provider: "lumicash", amount: 7000, currency: "BIF", phone: "25768191919" } });
  return { owner, event };
}

describe("revenue per currency", () => {
  it("the event dashboard reports one line per currency", async () => {
    const { owner, event } = await eventWithMixedSales();
    const dash = await api().get(`/events/${event._id}/dashboard`).set("Authorization", `Bearer ${owner.token}`);
    expect(dash.body.totals.revenue).toEqual([{ currency: "BIF", amount: 14000, tickets: 2 }, { currency: "RWF", amount: 5000, tickets: 1 }]);
    expect(dash.body.totals.paid).toBe(3);
    expect(dash.body.byPackage).toEqual(expect.arrayContaining([expect.objectContaining({ title: "VIP", currency: "BIF", revenue: 14000 })]));
    expect(dash.body.recent[0].payment.phone).toBe("25768191919");
  });
  it("the admin overview and organiser rows use the same shape", async () => {
    const admin = await registerAndLogin("admin@example.com");
    await eventWithMixedSales();
    const o = await api().get("/admin/overview").set("Authorization", `Bearer ${admin.token}`);
    expect(o.body.totals.revenue).toEqual([{ currency: "BIF", amount: 14000, tickets: 2 }, { currency: "RWF", amount: 5000, tickets: 1 }]);
    expect(o.body.organisers[0].revenue).toEqual(o.body.totals.revenue);
  });
  it("the attendee CSV shows Lumicash phones and amounts", async () => {
    const { owner, event } = await eventWithMixedSales();
    const csv = await api().get(`/events/${event._id}/attendees.csv`).set("Authorization", `Bearer ${owner.token}`);
    expect(csv.text).toContain("+25768191919"); expect(csv.text).toContain("7000");
  });
});
```

- [ ] **Step 2: Update** `tests/mock-payments.test.ts:84` to `expect(dash.body.totals).toEqual({ tickets: 1, paid: 1, revenue: [{ currency: "RWF", amount: 5000, tickets: 1 }], consumed: 0, pending: 1 })`.
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** `services/reporting.ts` and the four call sites.
- [ ] **Step 5: Run the whole suite, expect PASS.**
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(reports): revenue per currency; read the payment block with momo fallback"`.

---

### Task 10: SMS router by country prefix

**Files:**
- Create: `services/sms/index.ts`, `services/sms/africastalking.ts`, `services/sms/log.ts`, `services/sms/templates.ts`
- Delete: `services/sms.ts` (its content moves to `africastalking.ts`)
- Modify: `services/tickets.ts:31-37,67-90` (`ticketSms` gains `language`; `issueTickets` records `smsStatus`), `models/tickets.ts` (`smsStatus: String`)
- Test: `tests/sms-routing.test.ts`

**Interfaces:**
- `services/sms/index.ts` (default export keeps `sendMessage(to: string, message: string, from?: string): void`, so `vi.mock("../services/sms")` keeps working):
  ```ts
  export type Language = "rw" | "fr" | "rn" | "en";
  export interface SmsRoute { countryCode: string; language: Language; senderId?: string; send(to: string, text: string): Promise<void> }
  export function smsRoutes(): SmsRoute[]           // from env; cached; resetSmsRoutes() for tests
  export function routeFor(to: string): SmsRoute | undefined   // longest countryCode prefix match on digits of `to`
  export function languageFor(to: string): Language // route language, default "rw"
  export function resetSmsRoutes(): void
  export default function sendMessage(to: string, message: string, from?: string): void   // fire-and-forget; warns "SMS to <to> unrouted" when no route
  ```
  Env: `SMS_ROUTES` comma list of country codes. For each `CC`: `SMS_<CC>_PROVIDER` (`africastalking` | `log`), `SMS_<CC>_USERNAME`, `SMS_<CC>_API_KEY`, `SMS_<CC>_SENDER_ID`, `SMS_<CC>_LANG` (default `rw` for 250, `fr` for 257, `en` otherwise). When `SMS_ROUTES` is unset: one route `250` built from the legacy `SMS_API_USERNAME`, `SMS_API_KEY`, `SMS_SENDER_ID`, language `rw`, provider `africastalking`.
- `templates.ts`: `export function ticketText(lang: Language, p: { eventTitle?: string; number: number; link: string; packageTitle?: string; price?: number; currency?: string }): string`. `rw` is today's text byte-for-byte. `fr`: `Bienvenue à <event>. Votre billet <number> est ici <link>. Vous avez acheté <package> - <price> <currency>` (without the price clause when no price). `rn` returns the `fr` text. `en`: `Welcome to <event>. Your ticket <number> is here <link>. You bought <package> - <price> <currency>`.
- `services/tickets.ts`: `ticketSms(eventTitle, number, ticketPackage, language: Language = "rw")` delegates to `ticketText`. `issueTickets` uses `languageFor(phone)` and sets `smsStatus: routeFor(phone) ? "sent" : "unrouted"` on each ticket (and `"none"` when there is no phone).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import sendMessage, { routeFor, languageFor, resetSmsRoutes } from "../services/sms";
import { ticketText } from "../services/sms/templates";
import { issueTickets } from "../services/tickets";
import { seedEvent } from "./helpers";
const env = { ...process.env };
beforeEach(() => { delete process.env.SMS_ROUTES; resetSmsRoutes(); });
afterEach(() => { process.env = { ...env }; resetSmsRoutes(); });

describe("sms routing", () => {
  it("legacy env makes a single 250 route in Kinyarwanda", () => {
    process.env.SMS_API_USERNAME = "u"; process.env.SMS_API_KEY = "k"; resetSmsRoutes();
    expect(routeFor("+250788123456")?.countryCode).toBe("250");
    expect(languageFor("+250788123456")).toBe("rw");
    expect(routeFor("+25768191919")).toBeUndefined();
  });
  it("SMS_ROUTES declares per-country routes with their own language", () => {
    Object.assign(process.env, { SMS_ROUTES: "250,257", SMS_250_PROVIDER: "log", SMS_257_PROVIDER: "log", SMS_257_LANG: "fr" }); resetSmsRoutes();
    expect(languageFor("+25768191919")).toBe("fr");
    expect(languageFor("+250788123456")).toBe("rw");
  });
  it("templates: rw unchanged, fr for Burundi, rn falls back to fr", () => {
    const p = { eventTitle: "Bujumbura Live", number: 10000001, link: "http://api.test/tickets/validate/10000001?showOnly=1", packageTitle: "VIP", price: 7000, currency: "BIF" };
    expect(ticketText("rw", p)).toBe("Ikaze mu gitaramo Bujumbura Live. Itike yanyu 10000001 mwayibona aha http://api.test/tickets/validate/10000001?showOnly=1. Mwaguze VIP ticket - igura 7000 BIF");
    expect(ticketText("fr", p)).toBe("Bienvenue à Bujumbura Live. Votre billet 10000001 est ici http://api.test/tickets/validate/10000001?showOnly=1. Vous avez acheté VIP - 7000 BIF");
    expect(ticketText("rn", p)).toBe(ticketText("fr", p));
  });
  it("an unrouted number does not block issue and marks the ticket", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = await seedEvent();
    const [t]: any = await issueTickets({ quantity: 1, event: event._id, ticketPackage: event.packages[0], phone: "25768191919" });
    expect(t.smsStatus).toBe("unrouted");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unrouted"));
    warn.mockRestore();
  });
  it("a routed number is sent through its route and marked sent", async () => {
    Object.assign(process.env, { SMS_ROUTES: "257", SMS_257_PROVIDER: "log", SMS_257_LANG: "fr" }); resetSmsRoutes();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = await seedEvent({ title: "Bujumbura Live" });
    const [t]: any = await issueTickets({ quantity: 1, event: event._id, ticketPackage: event.packages[0], phone: "25768191919" });
    expect(t.smsStatus).toBe("sent");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Bienvenue à Bujumbura Live"));
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the router, the two providers (`log` provider does `console.log("SMS[log] to <to>: <text>")`), templates, and the `tickets.ts` changes.
- [ ] **Step 4: Run the whole suite, expect PASS** (`payments.test.ts` SMS assertions still pass because the mock replaces the module's default export).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(sms): per-country routes, languages and unrouted handling"`.

---

### Task 11: Env documentation and startup check

**Files:**
- Modify: `.env.example`, `index.ts` (call `enabledProviders()` and `smsRoutes()` once at boot inside a try/catch that logs and exits with code 1 on `ProviderConfigError`)
- Test: `tests/providers.test.ts` (append one test that `enabledProviders()` throws `ProviderConfigError` for `lumicash` with no env)

- [ ] **Step 1: Append the test**; run; expect FAIL only if the error class is not thrown (it may already pass after Task 5; then this step records the contract).
- [ ] **Step 2: Add to `.env.example`** the block from the spec's "Env summary" verbatim (PAYMENT_PROVIDERS, MOMO_CURRENCIES, LUMICASH_*, LUMICASH_MSISDN_FORMAT, SMS_ROUTES and the two per-country blocks), with one comment line each; mark `PAYMENTS_MODE` as deprecated alias.
- [ ] **Step 3: Boot check** in `index.ts`; run `npx tsc` to verify the build.
- [ ] **Step 4: Commit** — `git commit -am "chore: document payment and SMS env; fail fast on misconfiguration"`.

---

### Task 12: Backend whole-suite run and build

- [ ] **Step 1:** `cd tickets-backend && npx vitest run` — Expected: all files green.
- [ ] **Step 2:** `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3:** No commit (nothing changed); if anything was fixed, commit `fix(payments): ...`.

---

### Task 13: Web purchase panel for multiple providers

**Files:**
- Create: `app/hooks/useProviders.js`, `public/images/lumicash.png` (a 44×44 placeholder PNG the partner can replace; generate with any tool, do not copy a trademarked logo from the web)
- Modify: `app/hooks/usePayment.js`, `app/components/PurchasePanel.js`

**Interfaces:**
- `useProviders()` ⇒ `{ providers, loading, error }`, fetching `${API_URL}/payments/providers` once (module-level cache).
- `usePayment(event, eventPackage, provider)` ⇒ same return shape as today plus `lookup(phoneDigits)` ⇒ `Promise<{ ok, name?, reason? }>`; `pay(phoneDigits, quantity, buyer)` posts `{ provider: provider.id, eventId, packageId: eventPackage._id, quantity, phone, buyer }` to `/payments/start`; `200` ⇒ set status/tickets/testMode from body; `202` ⇒ start the poll on `/payments/${refId}` (first delay 15 s, mock 500 ms); `402` ⇒ status `FAILED`, reason from body; other non-OK ⇒ error.
- `PurchasePanel`:
  - `const options = providers.filter(p => !p.currencies.length || p.currencies.includes(selected.currency || "RWF"))`.
  - zero ⇒ `<div className="notice-warn">Online payment is not available for tickets priced in {currency}.</div>` and no form.
  - one ⇒ no picker; `provider = options[0]`.
  - several ⇒ `role="radiogroup" aria-label="Payment method"` of buttons with the provider image (`/images/mtn.png` for momo, `/images/lumicash.png` for lumicash, none for mock) and label.
  - prefix badge shows `+{provider.phone.countryCode}`; validation uses `new RegExp(provider.phone.pattern)` and `provider.phone.hint` as the error.
  - Lumicash only (`provider.lookup` is advertised by `id === "lumicash"`): after the number matches the pattern, debounce 600 ms, call `payment.lookup`; show `Wallet holder: {name}` or the reason; the pay button is disabled until `ok`.
  - Pay button text: `Pay {total.toLocaleString()} {currency}`; pending copy: `Approve the payment on your phone. Keep this page open; we check with {provider.label} every few seconds.`; timeout copy names `{provider.label}`.
  - Keep `data-testid`/labels used by the smoke test: label text `Enter a telephone number for payment` stays; the button name changes from `Pay online` to `Pay …` (Task 15 updates the test).

- [ ] **Step 1: Implement** the hook changes and the panel.
- [ ] **Step 2: Verify** — `cd tickets-web && npx next build`. Expected: build succeeds.
- [ ] **Step 3: Manual check** with the backend on `PAYMENT_PROVIDERS=mock`: open an event, the panel shows no picker, the button reads `Pay 5,000 RWF`, a purchase shows tickets immediately with the test-mode note.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(web): provider-aware purchase panel"`.

---

### Task 14: Web dashboards, admin page, event form

**Files:**
- Modify: `app/organiser/events/[id]/page.js:84-190`, `app/admin/platform/page.js:61-79`, `app/components/EventForm.js` (CURRENCIES gains `BIF`; warning per package), `app/components/TicketView.js` (no change unless it reads `momoPayload`)
- Create: `app/admin/payments/page.js`

**Interfaces:**
- Organiser dashboard: one `Tile` per entry in `totals.revenue` labelled `Revenue (${currency})` (an empty array shows one tile `Revenue` with `0`); the "paid by MoMo" hint becomes `paid online`; per-package table gains a currency column; the recent-sales phone/amount cells read `t.payment?.phone ?? t.momoPayload?.payer?.partyId` and `t.payment?.amount ?? t.momoPayload?.amount`.
- Admin platform: revenue tile(s) per currency; organiser row renders `revenue.map(r => `${r.amount.toLocaleString()} ${r.currency}`).join(" · ")`.
- `EventForm`: fetches `/payments/providers` via `useProviders()`; next to a package whose currency no provider lists, shows `No online payment method accepts {currency} on this installation`.
- `app/admin/payments/page.js`: table of `GET /admin/payments?status=PENDING` plus a status filter (PENDING / FAILED / SUCCESSFUL) and a provider filter; each row has a `Verify now` button posting to `/admin/payments/:refId/verify` and showing the returned status. Link it from the admin layout nav as `Payments`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** — `npx next build` succeeds; with the backend seeded from the revenue test fixture, the dashboard shows two revenue tiles.
- [ ] **Step 3: Commit** — `git commit -am "feat(web): per-currency revenue, admin payments page, BIF"`.

---

### Task 15: Playwright smoke on the new API

**Files:**
- Modify: `e2e/smoke.spec.js:49,104-110`

- [ ] **Step 1:** Change the button locator to `page.getByRole("button", { name: /^Pay / })`. Change the API seed to `request.post(`${API}/payments/start`, { data: { provider: "mock", eventId: event._id, packageId: event.packages[0]._id, quantity: 1, phone: "788000111" } })` and read `tickets` from that response directly (no status call).
- [ ] **Step 2: Run** — backend with `PAYMENT_PROVIDERS=mock`, then `cd tickets-web && npx playwright test`. Expected: both tests pass.
- [ ] **Step 3: Commit** — `git commit -am "test(e2e): purchase through /payments with the mock provider"`.

---

## Sandbox checklist (after the code is done, before go-live with Lumicash)

Run against Lumicash's test environment with the partner's credentials and record the answers in the spec's "Open items":
1. Does the buyer get any prompt on their phone when cashout runs? If yes, change `lumicash.start` to return `pending` on `01` and rely on `status`.
2. Is a 32-hex `RequestId` accepted? If not, switch `toRequestId` to a 15-digit numeric id (time-based) and keep the mapping in `momoPayload.requestId`.
3. `CustomerMobile` with or without `257` (`LUMICASH_MSISDN_FORMAT`).
4. Does the signature verify with Bujumbura-time `CreatedDate`? If `02`, try UTC and change `LUMICASH_TZ`/`LUMICASH_OFFSET` together.
5. `verifytransaction`: what `TransCode` is expected when the first call never returned.
6. `Amount` as a JSON number (current) or string.
