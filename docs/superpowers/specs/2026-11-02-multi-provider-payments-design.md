# Multi-provider payments (MoMo + Lumicash, Stripe-ready) — design

Date: 2026-11-02. Status: awaiting sign-off.

## Intent (what was asked)
"We need to integrate with a payment gateway provider [Lumicash]. Lumicash operates in Burundi, different from how we were selling tickets using MoMo in Rwanda. Now that we are selling the product to a partner of Lumicash we need to redo the integration. If we could keep both (MoMo and Lumicash) that would be great. Single deployment to sell both MoMo and Lumicash. We will also in the future support Stripe card payments. Let [the providers] be set in the env variables when deploying."

Provider spec: Lumicash "API Document Specification v1.0" (23/11/2022), Google Doc `1svP4OqluiILtJDnMzPHvWerwdKcSSCmk6K6-l91NqrQ`. A plain-text copy is checked in next to this file as `2026-11-02-lumicash-api-v1.0.txt` so the builder does not depend on the doc staying shared.

## Decisions the user made
1. Keep MTN MoMo (Rwanda) and add Lumicash (Burundi). Both live in one codebase and can run in one deployment.
2. Which providers are on is a deployment setting (environment variables), not an organiser or per-event choice.
3. When more than one provider is enabled, the buyer picks the method on the purchase panel. When only one is enabled, no picker is shown.
4. A provider is only offered for a package whose currency it can take (MoMo: RWF; Lumicash: BIF). No currency conversion.
5. Stripe (cards) comes later and must slot in without touching the other providers or the ticket-issue path.
6. Revenue is reported per currency (one figure per currency, never a mixed sum).
7. SMS delivery gets a per-country seam next to the payment-provider seam, so Burundi buyers can be served by a different gateway, sender ID and language than Rwanda buyers.

## Goals
- A buyer in Burundi can buy a ticket with a Lumicash wallet number and receive it by SMS, exactly like a MoMo buyer in Rwanda does today.
- Tickets are issued exactly once per payment, whatever provider ran, and the dashboards keep showing revenue and payer numbers for all of them.
- Adding Stripe later means adding one provider module, one env block, and one purchase-panel branch.

## Non-goals
- Refunds or payouts (Lumicash RequestType 0 "deposit" is not used).
- Currency conversion, multi-currency pricing on one package, or changing how organisers price events.
- Organiser-level provider settings or per-event payment configuration.
- Building the Stripe integration now. The design only leaves room for it.
- Reconciliation reports against the provider's ledger.

## Anti-goals (would make this a failure even if it works)
- Issuing a ticket when money did not move, or taking money and issuing nothing with no way to recover.
- Charging a Lumicash wallet without the buyer having clearly confirmed the amount on our page (see "Consent" below).
- Leaking the agent wallet password, signing key or partner credentials to the browser or to logs.
- Breaking the existing MoMo flow or its tests.

## Constraints and facts from the Lumicash spec
- Three endpoints, all `POST` JSON with HTTP Basic auth (`Base64(user:pass)`), served over plain HTTP on a private address (`http://10.225.6.112:9020/ewapi/...`). Network reachability (VPN or whitelist) is the partner's responsibility; the base URL is an env value.
  - `api/3rd/partner/get-account`: body `{ toAccPhone }` → `ResponseCode` `01` ok / `05` locked or missing / `00` error. `ResponseMessage` on success is a JSON *string* with `accountName`, `accountId`, `phoneNumber`.
  - `api/3rd/customer/transaction/partner/cashout-cashin`: the money move. `RequestType` **1 = cashout (debit the customer's wallet to the agent wallet; this is how we collect a ticket payment)**, 0 = deposit (we pay the customer; unused). Returns `ResponseCode` (`01` success; `02` bad signature; `03` wallet locked/missing; `04` customer not found/no permission; `10` insufficient funds; `17,24,25,26,31,32,35` over limit; `00` system error or amount over limit), `ResponseMessage`, `CreatedDate`, and `RequestId` (Lumicash's own transaction code, distinct from ours).
  - `api/3rd/customer/transaction/verifytransaction`: `{ RequestId, PartnerCode, TransCode, ServiceId, TransDate (yyyyMMdd), Type: "1" }` → `ResponseCode` (`01` found; `00` "RequestId already exists" (sic); `401` auth; `400` bad request; `999` error) plus `Status`, `TransCode`, `TransAmount`, `TransFee`.
- Cashout request fields: `Partner`, `RequestId` (ours, unique), `CustomerMobile`, `AgentMobile`, `AgentCode`, `Password` (agent wallet password), `Amount` (decimal), `CreatedDate`, `RequestType`, `Description`, `Signature`.
- `Signature = MD5(Key + CreatedDate("yyyyMMddHHmmss") + Amount("####") + CustomerMobile + AgentCode + Partner + RequestType + RequestId)`, lowercase hex. `Key` is a secret issued by Lumicash. `Amount("####")` is the integer amount with no separators (so 1000, not 1,000 or 1000.00).
- `CreatedDate` in the JSON body is a .NET date string: `/Date(<epoch ms>+0200)/`. The signature uses the same instant formatted `yyyyMMddHHmmss`. The spec does not say which timezone the formatted string uses; the samples carry `+0200` (CAT, Burundi). Builder: format in `Africa/Bujumbura` and make the offset a constant next to the formatter so it can be changed in one place if the sandbox disagrees.
- Sample code in the spec hits a different host/path (`10.225.6.102:9900/api/3rd/customer/transaction/cashout-cashin`) than the tables. Treat the base URL and the path as configuration, not as fixed.
- The call is synchronous. There is no callback URL anywhere in the spec.
- Amounts are integer BIF.

## Consent (flag for the user, not blocking the build)
The cashout request carries the *agent's* wallet password, not the buyer's. The spec shows no OTP or buyer-side approval. Until Lumicash confirms otherwise, assume the debit happens as soon as we call. Therefore:
- The purchase panel shows the exact amount and the wallet number and the button reads "Pay <amount> BIF from <number>" so the click is an explicit confirmation.
- Before calling cashout we call `get-account` and show the account holder name returned by Lumicash under the number field, so the buyer sees whose wallet is about to be charged. If lookup fails with `05` we stop there with a clear message and never call cashout.
- This must be confirmed with Lumicash (or their partner) during sandbox testing. If buyers do get a prompt on their phone, the "Pay" step becomes pending-then-verify (see "Provider contract") with no other change.

## Architecture

### Provider contract (backend, `services/providers/`)
One interface, three implementations (`momo.ts`, `lumicash.ts`, and a `mock.ts` replacing today's `PAYMENTS_MODE=mock` branches), plus a registry.

```ts
interface PaymentProvider {
  id: "momo" | "lumicash" | "stripe" | "mock";
  label: string;                       // "MTN MoMo", "Lumicash"
  currencies: string[];                // ["RWF"], ["BIF"]
  phone: { countryCode: "250" | "257"; pattern: RegExp; hint: string } | null; // null for Stripe
  /** Optional pre-check used by the panel to show the account holder. */
  lookup?(phone: string): Promise<{ ok: true; name?: string } | { ok: false; reason: string }>;
  /** Starts (and for synchronous providers, completes) collection. */
  start(input: StartInput): Promise<StartResult>;
  /** Re-reads the provider's view of a payment. Called on poll, on callback, on timeout. */
  status(payment: PaymentRecord): Promise<StatusResult>;
  /** Optional: parse an inbound notification and return the payment ref it concerns. */
  callbackRef?(req: Request): string | undefined;
}
type StartInput = { refId: string; amount: number; currency: string; phone?: string; description: string };
type StartResult = { outcome: "pending" | "successful" | "failed"; providerRef?: string; reason?: string; raw: any };
type StatusResult = { outcome: "pending" | "successful" | "failed"; providerRef?: string; amount?: number; currency?: string; payerPhone?: string; reason?: string; raw: any };
```

- `outcome` is normalised. `settlePayment` only ever sees `pending | successful | failed`; provider status strings (MTN's `SUCCESSFUL`/`FAILED`/`REJECTED`/..., Lumicash's `01`/`10`/...) are mapped inside the provider.
- The registry reads `PAYMENT_PROVIDERS` (comma-separated, e.g. `momo,lumicash`), instantiates each listed provider, and fails fast at startup if a listed provider is missing a required env value. `mock` may be listed alone for test/staging; it accepts any currency. Unlisted providers do not exist as far as the API is concerned.
- `GET /payments/providers` (public) returns `[{ id, label, currencies, phone: { countryCode, pattern: string, hint } }]` for the enabled providers so the web app renders the picker and validates numbers without hard-coding 250.

### Routes
- New router mounted at `/payments` (same rate limit as `/momo`):
  - `POST /payments/start` body `{ provider, eventId, packageId, quantity, phone, buyer }`. **The price is never taken from the client.** The server loads the event, finds the package by `packageId`, and charges `package.price × quantity` in `package.currency`; a request with no resolvable package is a 400. (The old `/momo/requestToPay` trusts the client's amount. That was tolerable while the buyer approved the amount on their phone; with Lumicash we are the ones debiting, so a tampered price would become a 1 BIF ticket.) Validates: provider enabled; package currency in provider's currencies; phone matches provider pattern. Reserves capacity, creates the payment record with `provider`, calls `provider.start`. If the result is `successful` it settles immediately and responds `200 { refId, status: "SUCCESSFUL", tickets }`. If `pending` → `202 { refId, status: "PENDING" }`. If `failed` → settles as failed, releases seats, `402 { refId, status: "FAILED", reason }`.
  - `GET /payments/:refId` → same body shapes as today's `statusOfRequest`, via `provider.status` + `settlePayment`.
  - `POST /payments/:provider/callback` (and `PUT`) → `provider.callbackRef(req)` finds the record, then status + settle. MoMo is the only user today; `X-Callback-Url` for MoMo becomes `${backendUrl()}/payments/momo/callback`. The old `/momo/callback` stays mounted and forwards, because MTN may already have the old URL.
  - `POST /payments/lookup` body `{ provider, phone }` → `{ ok, name }` for providers that implement `lookup`. Rate limited harder (10/min/IP) because it reveals a name for a number.
- `/momo/*` routes stay for one release, implemented by delegating to the same service functions with `provider = "momo"`, so an old web build keeps working against a new backend. They keep today's client-supplied amount behaviour (MTN still shows the buyer the amount to approve), so existing tests pass unchanged. Remove after the web is deployed.
- Admin follow-up for stuck payments (my call, see "Stuck payments"): `GET /admin/payments?status=&provider=` lists records, and `POST /admin/payments/:refId/verify` re-runs `provider.status` + `settlePayment`. There is **no** "mark as paid" override: a ticket is only ever issued when the provider says the money moved. If Lumicash's ledger shows a debit that verify never confirms, the operator refunds through Lumicash's own tools, outside this system. Both endpoints are admin-only JSON; a small admin page (`/admin/payments`) lists pending/failed ones with a "Verify now" button.

### Payment record (`models/payments.ts`)
- Add `provider: String` (default `"momo"` so existing rows are correct), `providerRef: String` (Lumicash's `RequestId`/`TransCode`, MTN's `financialTransactionId`, Stripe's payment-intent id later), `amount: Number`, `currency: String`, `phone: String`.
- `momoPayload` stays and keeps holding the provider's raw status for every provider (field name is legacy; renaming it across the aggregation pipelines is churn with no behaviour gain). `payload` keeps holding what we sent.
- Add index `{ provider: 1, providerRef: 1 }`.

### Revenue per currency
`services/dashboard.ts`, `routes/routeAdmin.ts` and the tickets summary stop producing one `revenue` number. Every aggregation groups by `$ifNull: ["$payment.currency", "$ticketPackage.currency", "RWF"]` and returns `revenue: [{ currency, amount, tickets }]` sorted by amount. The admin organiser roll-up keys its map by `owner + currency`. The web shows one revenue tile per currency (one install, one currency means it looks as today) and labels the per-package chart with each package's own currency instead of `packages[0].currency`. An event may hold packages in more than one currency; nothing forbids it and the reports stay correct.

### Ticket record and the places that read `momoPayload`
Tickets currently get `momoPayload` (raw MTN status) and `momoRef`; the dashboard, admin stats and organiser sale table read `momoPayload.amount` and `momoPayload.payer.partyId`. To keep those working for every provider without rewriting them:
- `issueTickets` gets a new `payment: { provider, ref, amount, currency, phone }` option and stores it on the ticket as `payment`. It still stores `momoPayload`/`momoRef` for MoMo so nothing legacy changes.
- `services/dashboard.ts`, `routes/routeAdmin.ts`, `routes/routeTickets.ts` summary: amount becomes `$ifNull: ["$payment.amount", <existing momoPayload conversion>]`; paid becomes "has `payment` or has `momoPayload`"; payer phone becomes `$ifNull: ["$payment.phone", "$momoPayload.payer.partyId"]`. Organiser sale table in the web reads `t.payment?.phone ?? t.momoPayload?.payer?.partyId` likewise.
- `Currencies` enum gains `bif = "BIF"`. The organiser event form's currency select offers BIF.

### Lumicash provider specifics
- `CustomerMobile` format (with or without the 257 prefix) is unknown: the JSON sample uses `25768999555`, the code samples use `69988333`. It is part of the signature, so a wrong guess fails every call with `02`. Builder: one formatter with an env switch `LUMICASH_MSISDN_FORMAT=international|local` (default international), confirmed in the sandbox.
- Env: `LUMICASH_BASE_URL`, `LUMICASH_BASIC_USER`, `LUMICASH_BASIC_PASS`, `LUMICASH_PARTNER`, `LUMICASH_AGENT_MOBILE`, `LUMICASH_AGENT_CODE`, `LUMICASH_AGENT_PASSWORD`, `LUMICASH_SIGN_KEY`, `LUMICASH_SERVICE_ID` (for verify; the sample shows `CHECK_TRANSATION`, keep configurable). All required when `lumicash` is listed.
- `RequestId` sent to Lumicash is our `refId` with hyphens removed (the spec shows numeric-looking ids; a 32-hex string is the safe choice and stays unique). The builder should confirm the accepted length/charset in the sandbox and fall back to a 15-digit numeric id derived from time + counter if hex is rejected; keep the mapping on the record either way.
- `start` = cashout with `RequestType: 1`. Mapping: `01` → `successful` (providerRef = response `RequestId`); `10` → `failed` "Insufficient balance"; `03`/`04` → `failed` "Wallet not found or locked"; `02` → `failed` and log at error level (signature bug on our side); over-limit codes → `failed` "Over the wallet's limit"; `00` → `failed` "Lumicash error". Network error or timeout (10 s) → `pending` with the request retained, so `status` can verify. Never retry the cashout call itself: a retry with a new `RequestId` could charge twice.
- `status` = `verifytransaction` with our `RequestId`, `TransCode` = providerRef if known (else our RequestId; builder to confirm in sandbox what the API wants when the first call never returned), `TransDate` = the `CreatedDate` we sent, `yyyyMMdd`. `Status: "01"` → successful, anything else with `ResponseCode: 01` → failed, `ResponseCode` not `01` → pending (we do not know). Stale pending Lumicash payments are released by the existing `releaseStalePayments` after 30 minutes, but only after one last `status` call succeeded in saying "not found/failed"; if verify itself is unreachable the record stays pending and is listed for manual follow-up (`GET /admin/payments?status=PENDING&provider=lumicash`, admin only).
- Secrets are read from env at call time and never placed on the record, in responses, or in logs. Log lines carry `refId`, `ResponseCode`, and the message only.
- Signing helper is a pure function `sign({ key, createdAt, amount, customerMobile, agentCode, partner, requestType, requestId })` with a unit test that reproduces a hand-computed MD5 for fixed inputs.

### MoMo provider
Currencies come from `MOMO_CURRENCIES` (comma list, default `RWF`) rather than a constant, because the MTN sandbox only accepts EUR and because `Currencies` already offers USD and EUR to organisers. Any package in a currency no enabled provider lists is simply not buyable online, and the organiser event form shows a warning next to such a currency ("No online payment method accepts USD on this installation").

Code moves from `routes/routeMomo.ts` into `services/providers/momo.ts` with no behavioural change: `start` posts `requesttopay` and returns `pending`; `status` GETs the request and maps `SUCCESSFUL` → successful, the terminal failure list → failed, else pending; `callbackRef` reads `externalId || referenceId`. Payer phone from `payer.partyId`.

### Mock provider
Replaces the `PAYMENTS_MODE=mock` scatter. `start` returns `successful` at once, so a mock purchase now completes on the first response rather than after a poll (the web handles both). Existing mock tests are updated to the new route; the "unknown reference is a 404, not a free ticket" rule stays. `PAYMENTS_MODE=mock` is honoured as an alias for `PAYMENT_PROVIDERS=mock` for one release so staging keeps working.

### Web (`tickets-web`)
- `usePayment` takes a provider and posts to `/payments/start`. A `200` with `SUCCESSFUL` sets tickets immediately; a `202` starts the existing poll against `/payments/:refId`; a `402` shows the failure. The first-poll delay (15 s) applies only to pending outcomes.
- `PurchasePanel`:
  - fetches `/payments/providers` once; filters to those whose `currencies` include the selected package's currency.
  - zero matches: shows "Online payment is not available for this ticket's currency" and no form.
  - one match: no picker; the prefix badge, placeholder, validation and hint come from that provider.
  - several: a radio row with the provider logos (`/images/mtn.png`, new `/images/lumicash.png`) above the number field.
  - Lumicash: after a valid number is typed, calls `/payments/lookup` (debounced) and shows "Wallet holder: <name>" or the lookup error; the Pay button is disabled until lookup succeeds. Button text: "Pay <total> <currency>".
  - Pending copy mentions the chosen provider's label instead of "MTN".
- Ticket page and organiser dashboard read the normalised `payment` fields with the legacy fallback above.

### SMS per country (`services/sms/`)
Today `services/sms.ts` is one Africa's Talking client with sender `EVENTIXR` and a Kinyarwanda template. It becomes a router:

```ts
interface SmsRoute { countryCode: string; send(to: string, text: string): Promise<void>; language: "rw" | "fr" | "rn" | "en" }
```
- Routes are declared by env, one block per country code: `SMS_ROUTES=250,257`, then `SMS_250_PROVIDER=africastalking`, `SMS_250_USERNAME`, `SMS_250_API_KEY`, `SMS_250_SENDER_ID`, `SMS_250_LANG=rw`, and the same for `257`. The existing unprefixed `SMS_*` keys keep working as the `250` route for one release.
- `sendMessage(to, text)` picks the route by the international prefix of `to`. No route for a prefix: log at warn level, record `smsStatus: "unrouted"` on the ticket, do not fail the purchase (the buyer still has the ticket link on the page and by email if given).
- Provider implementations: `africastalking` (exists) and a `log` provider for test/staging. A second gateway for Burundi, if the partner's numbers cannot be reached through Africa's Talking, is one more file implementing `send`; the design does not pick it because the partner has not said which gateway they use.
- `ticketSms(event, number, pkg, language)` returns the text in the route's language. Templates: `rw` is today's text unchanged; `fr` is written in the plan; `rn` (Kirundi) ships as a placeholder equal to `fr` until the partner supplies wording; `en` is a plain fallback. The language is chosen by route, not by provider, so a Burundi MoMo buyer (if that ever exists) gets the same text as a Burundi Lumicash buyer.
- Tests: routing by prefix, unrouted number does not block issue, template per language.

### Env summary (new keys)
```
PAYMENT_PROVIDERS=momo,lumicash        # or momo | lumicash | mock
LUMICASH_BASE_URL=http://10.225.6.112:9020/ewapi
LUMICASH_BASIC_USER= LUMICASH_BASIC_PASS=
LUMICASH_PARTNER= LUMICASH_AGENT_MOBILE= LUMICASH_AGENT_CODE= LUMICASH_AGENT_PASSWORD=
LUMICASH_SIGN_KEY= LUMICASH_SERVICE_ID=CHECK_TRANSATION
```
```
SMS_ROUTES=250,257
SMS_250_PROVIDER=africastalking SMS_250_USERNAME= SMS_250_API_KEY= SMS_250_SENDER_ID=EVENTIXR SMS_250_LANG=rw
SMS_257_PROVIDER=africastalking SMS_257_USERNAME= SMS_257_API_KEY= SMS_257_SENDER_ID= SMS_257_LANG=fr
MOMO_CURRENCIES=RWF
```
Existing `MOMO_*` and `SMS_*` keys are unchanged. `.env.example` is updated.

## Testing
- Backend (vitest + supertest, existing harness): provider registry (enabled list, missing-env failure, currency filter); Lumicash signing vector; Lumicash `start` success/insufficient/locked/timeout mapped correctly with a stubbed `fetch`; synchronous success issues exactly one ticket and a replayed status call does not issue again; failed cashout releases the seats; verify path after a timeout; `/payments/start` rejects a disabled provider, a currency mismatch and a bad phone; MoMo tests pass unchanged against `/momo/*` and against `/payments/*`; dashboard revenue sums a MoMo ticket and a Lumicash ticket together.
- Web: `next build`; Playwright smoke extended with a mock-provider purchase that completes without polling.
- Dashboard: an event with an RWF ticket and a BIF ticket reports two revenue lines, never one sum.
- Sandbox: a checklist (in the plan) of what to confirm with Lumicash's test environment before go-live: whether the buyer gets a prompt; `RequestId` format; `CustomerMobile` format; signature timezone; `verifytransaction` inputs when the first call timed out; whether `Amount` should be sent as a number or string.
- Other readers of `momoPayload` the builder must also switch to the `payment` fallback: the attendee CSV export and broadcast in `routes/routeEvents.ts`.

### Stuck payments
A Lumicash cashout can time out after the wallet was debited. The record stays `PENDING`; every status poll and the admin "Verify now" action call `verifytransaction` until it answers. `releaseStalePayments` may only expire a Lumicash record after a verify call has positively said failed/not found; an unreachable verify keeps the record pending indefinitely and visible on the admin page. Nothing in the system can issue a ticket without a provider confirmation.

## Left to the builder
- File layout inside `services/providers/`, and whether the registry is a module-level singleton or built per request (singleton with a `resetProviders()` for tests is the obvious choice).
- Exact shape of the `/payments/providers` response beyond the fields named.
- Debounce timing and visual design of the picker, within the current panel style.
- Whether `/momo/*` compatibility routes are thin wrappers or an Express `router.use` rewrite.

## Open items (not blocking the build)
- Lumicash sandbox credentials, signing key, partner code, service ID and network access from the server to `10.225.6.x`.
- Confirmation from Lumicash whether the buyer sees any prompt when a cashout runs (see "Consent").
- Which SMS gateway and sender ID the Burundi partner uses, and the Kirundi ticket text.

Status: 2026-11-02, reviewed by a builder check; the two questions it raised for the user (revenue per currency, SMS seam) are answered above.
