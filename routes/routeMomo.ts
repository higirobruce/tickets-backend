import { randomUUID } from "crypto";
import { Router, Request, Response } from "express";
import { paymentModel, PaymentStatuses } from "../models/payments";
import { ensureUserAuthorized } from "../middleware/auth";
import { backendUrl, ticketSms, toInternational } from "../services/tickets";
import {
  mockPayments,
  mockStatus,
  releaseStalePayments,
  reserveCapacity,
  settlePayment,
  successfulResponse,
} from "../services/payments";
import sendMessage from "../services/sms";

let router = Router();

const momoBase = () => process.env.MOMO_BASE_URL || "";
const momoHeaders = (token?: string) => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  "Ocp-Apim-Subscription-Key": process.env.MOMO_SUBSCRIPTION_KEY || "",
  "X-Target-Environment": process.env.MOMO_ENVIRONMENT || "",
});

function upstreamError(res: Response, err: unknown) {
  res.status(502).send({ errorMessage: `${err}` });
}

router.post("/getToken", ensureUserAuthorized, async (req, res) => {
  try {
    res.send(await getToken());
  } catch (err) {
    upstreamError(res, err);
  }
});

router.post("/requestToPay", async (req, res) => {
  const { eventId, event, ticketPackage, quantity, buyer, ...paymentPayload } = req.body || {};
  if (!paymentPayload?.amount || !paymentPayload?.payer?.partyId) {
    return res.status(400).send({ errorMessage: "amount and payer.partyId are required" });
  }
  const refId = randomUUID();
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const targetEvent = eventId || event || undefined;
  // MTN echoes externalId back in the callback; that is how we find the payment again.
  paymentPayload.externalId = refId;

  try {
    await releaseStalePayments();
    const reservation = await reserveCapacity(targetEvent, ticketPackage?._id, qty);
    if (!reservation.ok) {
      return res.status(409).send({
        errorMessage: reservation.remaining
          ? `Only ${reservation.remaining} left for ${ticketPackage?.title || "this package"}`
          : `${ticketPackage?.title || "This package"} is sold out`,
        remaining: reservation.remaining,
      });
    }

    const record = {
      refId,
      payload: paymentPayload,
      event: targetEvent,
      ticketPackage,
      quantity: qty,
      reserved: Boolean(targetEvent && ticketPackage?._id),
      buyer: buyer ? { name: buyer.name, email: buyer.email } : undefined,
    };

    if (mockPayments()) {
      await paymentModel.create(record);
      return res.status(202).send({ message: "Accepted (test mode, no payment taken)", refId, mock: true });
    }

    const { access_token } = await getToken();
    const payment = await paymentModel.create(record);
    const response = await fetch(`${momoBase()}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers: {
        ...momoHeaders(access_token),
        "X-Reference-Id": refId,
        "X-Callback-Url": `${backendUrl()}/momo/callback`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentPayload),
    });
    if (!response.ok) {
      await settlePayment(payment, { status: "FAILED", reason: response.statusText });
    }
    res.status(response.status).send({ message: response.statusText, refId });
  } catch (err) {
    upstreamError(res, err);
  }
});

/** Looks the payment up with MTN (or the mock) and applies the result. */
async function resolveAndSettle(payment: any, req: Request) {
  if (payment.status === PaymentStatuses.successful) {
    return { code: 200, body: await successfulResponse(payment) };
  }
  if (payment.status === PaymentStatuses.issuing) {
    return { code: 200, body: { ...(payment.momoPayload || {}), status: "PENDING" } };
  }
  const status = mockPayments() ? mockStatus(payment) : await fetchStatus(payment.refId);
  return settlePayment(payment, status);
}

router.get("/statusOfRequest/:refId", async (req, res) => {
  const refId = String(req.params.refId);
  try {
    let payment = await paymentModel.findOne({ refId });
    if (!payment) {
      if (mockPayments()) return res.status(404).send({ errorMessage: "Unknown payment reference" });
      // A client that started the payment before payment records existed.
      const { title, price, currency } = req.query;
      payment = await paymentModel.create({
        refId,
        ticketPackage: title
          ? { title: String(title), price: Number(price), currency: currency ? String(currency) : undefined }
          : undefined,
      });
    }
    const result = await resolveAndSettle(payment, req);
    res.status(result.code).send(result.body);
  } catch (err) {
    upstreamError(res, err);
  }
});

/**
 * MTN calls this when a payment reaches a final state. The body is never trusted on its own:
 * the status is re-read from MTN before anything is issued.
 */
const callback = async (req: Request, res: Response) => {
  const body = req.body || {};
  const refId = body.externalId || body.referenceId;
  const payment = refId ? await paymentModel.findOne({ refId: String(refId) }) : null;
  if (!payment) return res.status(404).send({ errorMessage: "Unknown payment reference" });
  try {
    const result = await resolveAndSettle(payment, req);
    res.status(result.code >= 500 ? 500 : 200).send({ received: true, status: result.body?.status });
  } catch (err) {
    upstreamError(res, err);
  }
};
router.post("/callback", callback);
router.put("/callback", callback);

router.post("/sendSMS", ensureUserAuthorized, async (req, res) => {
  const { partyId, ticketNumber, ticketPackage, eventTitle } = req.body;
  const to = toInternational(partyId);
  if (!to || !ticketNumber) {
    return res.status(400).send({ errorMessage: "partyId and ticketNumber are required" });
  }
  sendMessage(to, ticketSms(eventTitle, Number(ticketNumber), ticketPackage), "EVENTIXR");
  res.send({ message: "done" });
});

export default router;

async function fetchStatus(refId: string) {
  const { access_token } = await getToken();
  const response = await fetch(`${momoBase()}/collection/v1_0/requesttopay/${refId}`, {
    method: "GET",
    headers: momoHeaders(access_token),
  });
  if (!response.ok) throw new Error(`MoMo responded ${response.status} ${response.statusText}`);
  return response.json();
}

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
