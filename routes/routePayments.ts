import { Router, Request, Response, NextFunction } from "express";
import { paymentModel } from "../models/payments";
import { enabledProviders, getProvider } from "../services/providers/registry";
import { ProviderError } from "../services/providers/types";
import { callProvider, checkPayment, startPayment } from "../services/payments";

const router = Router();

/** A provider fault is 502 with its message; anything else is ours and goes to the app's 500 handler. */
function fail(res: Response, next: NextFunction, err: unknown) {
  if (err instanceof ProviderError) return res.status(502).send({ errorMessage: err.message });
  next(err);
}

/** Only what the checkout needs; never configuration. */
router.get("/providers", (req, res) => {
  res.send(enabledProviders().map(({ id, label, currencies, phone }) => ({ id, label, currencies, phone })));
});

router.post("/start", async (req, res, next) => {
  const { provider, eventId, packageId, quantity, phone, buyer } = req.body || {};
  try {
    const result = await startPayment({ provider, eventId, packageId, quantity, phone, buyer });
    res.status(result.code).send(result.body);
  } catch (err) {
    fail(res, next, err);
  }
});

router.post("/lookup", async (req, res, next) => {
  const { provider: id, phone } = req.body || {};
  const provider = getProvider(String(id));
  if (!provider?.lookup) return res.status(400).send({ errorMessage: "This payment method cannot look up accounts" });
  if (provider.phone && (typeof phone !== "string" || !new RegExp(provider.phone.pattern).test(phone))) {
    return res.status(400).send({ errorMessage: provider.phone.hint });
  }
  try {
    res.send(await callProvider(() => provider.lookup!(phone)));
  } catch (err) {
    fail(res, next, err);
  }
});

/**
 * Providers call this when a payment reaches a final state. The body only names the payment;
 * its status is always re-read from the provider before anything is issued.
 */
const callback = async (req: Request, res: Response, next: NextFunction) => {
  const provider = getProvider(String(req.params.provider));
  const refId = provider?.callbackRef?.(req);
  try {
    const payment = refId ? await paymentModel.findOne({ refId: String(refId), provider: provider!.id }) : null;
    if (!payment) return res.status(404).send({ errorMessage: "Unknown payment reference" });
    const result = await checkPayment(payment.refId);
    res.status(result.code >= 500 ? 500 : 200).send({ received: true, status: result.body?.status });
  } catch (err) {
    fail(res, next, err);
  }
};
router.post("/:provider/callback", callback);
router.put("/:provider/callback", callback);

router.get("/:refId", async (req, res, next) => {
  try {
    const result = await checkPayment(String(req.params.refId));
    res.status(result.code).send(result.body);
  } catch (err) {
    fail(res, next, err);
  }
});

export default router;
