import { randomUUID } from "crypto";
import { Router } from "express";
import { paymentModel } from "../models/payments";
import { ensureUserAuthorized } from "../middleware/auth";
import { ticketSms, toInternational } from "../services/tickets";
import { getToken } from "../services/providers/momo";
import { getProvider } from "../services/providers/registry";
import { callProvider, checkPayment, releaseStalePayments, reserveCapacity, settlePayment } from "../services/payments";
import sendMessage from "../services/sms";
import { callbackHandler, fail } from "./routePayments";

/**
 * Legacy client contract. Everything here is a thin wrapper over the provider layer, so the
 * old app keeps working while new clients use /payments.
 */
const router = Router();

router.post("/getToken", ensureUserAuthorized, async (req, res, next) => {
  try {
    res.send(await callProvider(() => getToken()));
  } catch (err) {
    fail(res, next, err);
  }
});

router.post("/requestToPay", async (req, res, next) => {
  const { eventId, event, ticketPackage, quantity, buyer, ...paymentPayload } = req.body || {};
  if (!paymentPayload?.amount || !paymentPayload?.payer?.partyId) {
    return res.status(400).send({ errorMessage: "amount and payer.partyId are required" });
  }
  // PAYMENTS_MODE=mock enables only the mock provider, so momo missing means test mode.
  const provider = getProvider("momo") ?? getProvider("mock");
  if (!provider) return res.status(400).send({ errorMessage: "MoMo is not enabled" });

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

    const payment = await paymentModel.create({
      refId,
      provider: provider.id,
      amount: Number(paymentPayload.amount),
      currency: paymentPayload.currency,
      // Without phone on the record the ticket SMS has nowhere to go.
      phone: paymentPayload.payer.partyId,
      payload: paymentPayload,
      event: targetEvent,
      ticketPackage,
      quantity: qty,
      reserved: Boolean(targetEvent && ticketPackage?._id),
      buyer: buyer ? { name: buyer.name, email: buyer.email } : undefined,
    });

    const result = await callProvider(() =>
      provider.start({
        refId,
        amount: Number(paymentPayload.amount),
        currency: paymentPayload.currency,
        phone: paymentPayload.payer.partyId,
        description: paymentPayload.payerMessage || "",
      }),
    );
    if (provider.id === "mock") {
      // Legacy clients poll statusOfRequest, which settles through the mock provider.
      return res.status(202).send({ message: "Accepted (test mode, no payment taken)", refId, mock: true });
    }
    if (result.outcome === "failed") {
      // statusText can be empty (HTTP/2, proxies), so never let the client see a blank or misleading message.
      const reason = result.reason || "Payment request failed";
      await settlePayment(payment, { outcome: "failed", reason, raw: result.raw });
      return res.status(502).send({ message: reason, refId });
    }
    res.status(202).send({ message: "Accepted", refId });
  } catch (err) {
    fail(res, next, err);
  }
});

router.get("/statusOfRequest/:refId", async (req, res, next) => {
  const refId = String(req.params.refId);
  try {
    if (!(await paymentModel.exists({ refId }))) {
      if (!getProvider("momo")) return res.status(404).send({ errorMessage: "Unknown payment reference" });
      // A client that started the payment before payment records existed.
      const { title, price, currency } = req.query;
      await paymentModel.create({
        refId,
        provider: "momo",
        ticketPackage: title
          ? { title: String(title), price: Number(price), currency: currency ? String(currency) : undefined }
          : undefined,
      });
    }
    const result = await checkPayment(refId);
    res.status(result.code).send(result.body);
  } catch (err) {
    fail(res, next, err);
  }
});

router.post("/callback", callbackHandler("momo"));
router.put("/callback", callbackHandler("momo"));

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
