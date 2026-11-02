import { Router, Request, Response } from "express";
import { paymentModel } from "../models/payments";
import { enabledProviders, getProvider } from "../services/providers/registry";
import { checkPayment, startPayment } from "../services/payments";

const router = Router();

/** A provider that cannot be reached is the upstream's fault, not the client's. */
function upstreamError(res: Response, err: unknown) {
  res.status(502).send({ errorMessage: `${err}` });
}

/** Only what the checkout needs; never configuration. */
router.get("/providers", (req, res) => {
  res.send(enabledProviders().map(({ id, label, currencies, phone }) => ({ id, label, currencies, phone })));
});

router.post("/start", async (req, res) => {
  const { provider, eventId, packageId, quantity, phone, buyer } = req.body || {};
  try {
    const result = await startPayment({ provider, eventId, packageId, quantity, phone, buyer });
    res.status(result.code).send(result.body);
  } catch (err) {
    upstreamError(res, err);
  }
});

router.post("/lookup", async (req, res) => {
  const { provider: id, phone } = req.body || {};
  const provider = getProvider(String(id));
  if (!provider?.lookup) return res.status(400).send({ errorMessage: "This payment method cannot look up accounts" });
  if (provider.phone && (typeof phone !== "string" || !new RegExp(provider.phone.pattern).test(phone))) {
    return res.status(400).send({ errorMessage: provider.phone.hint });
  }
  try {
    res.send(await provider.lookup(phone));
  } catch (err) {
    upstreamError(res, err);
  }
});

/**
 * Providers call this when a payment reaches a final state. The body only names the payment;
 * its status is always re-read from the provider before anything is issued.
 */
const callback = async (req: Request, res: Response) => {
  const provider = getProvider(String(req.params.provider));
  const refId = provider?.callbackRef?.(req);
  const payment = refId ? await paymentModel.findOne({ refId: String(refId), provider: provider!.id }) : null;
  if (!payment) return res.status(404).send({ errorMessage: "Unknown payment reference" });
  try {
    const result = await checkPayment(payment.refId);
    res.status(result.code >= 500 ? 500 : 200).send({ received: true, status: result.body?.status });
  } catch (err) {
    upstreamError(res, err);
  }
};
router.post("/:provider/callback", callback);
router.put("/:provider/callback", callback);

router.get("/:refId", async (req, res) => {
  try {
    const result = await checkPayment(String(req.params.refId));
    res.status(result.code).send(result.body);
  } catch (err) {
    upstreamError(res, err);
  }
});

export default router;
