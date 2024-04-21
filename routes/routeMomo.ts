import { randomUUID } from "crypto";
import { Router } from "express";
import fetch from "node-fetch";
import { createTickets } from "./routeTickets";
import sendMessage from "./routeSMS";

let router = Router();

router.post("/getToken", async (req, res) => {
  let token = await getToken(req);
  res.send(token);
});

router.post("/requestToPay", async (req, res) => {
  let refId = randomUUID();
  await getToken(req);
  let paymentPayload = req.body;
  req.session.paymentPayload = paymentPayload;

  fetch(`${process.env.MOMO_BASE_URL}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${req.session.accessToken}`,
      "X-Reference-Id": refId,
      "Ocp-Apim-Subscription-Key": process.env.MOMO_SUBSCRIPTION_KEY || "",
      "X-Target-Environment": process.env.MOMO_ENVIRONMENT || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(paymentPayload),
  })
    .then((response) => {
      res.status(response.status).send({ message: response.statusText, refId });
    })
    .catch((err) => {
      res.send({ errorMessage: `${err}` });
    });
});

router.get("/statusOfRequest/:refId", async (req, res) => {
  let { refId } = req.params;
  let { title, price, currency } = req.query;
  await getToken(req);
  fetch(`${process.env.MOMO_BASE_URL}/collection/v1_0/requesttopay/${refId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${req.session.accessToken}`,
      "Ocp-Apim-Subscription-Key": process.env.MOMO_SUBSCRIPTION_KEY || "",
      "X-Target-Environment": process.env.MOMO_ENVIRONMENT || "",
    },
  })
    .then((response) => {
      if (response.ok) {
        return response.json();
      } else {
        res.status(response.status).send(response.statusText);
      }
    })
    .then(async (response) => {
      let tickets: any[] = [];

      if (response.status === "SUCCESSFUL") {
        console.log("Payment session:", req.session);
        req.body.paymentPayload = req.session.paymentPayload;
        req.body.ticketPackage = { title, price, currency };
        await createTickets("1", req, tickets, res, response);

        res.send(response);
      } else {
        res.send(response);
      }
    })
    .catch((err) => {
      res.send({ errorMessage: `${err}` });
    });
});

router.post("/sendSMS", async (req, res) => {
  let { partyId, ticketNumber, qrUrl, ticketPackage } = req.body;
  sendMessage(
    `+${partyId}`,
    `Ikaze mu gitaramo NZAKINGURA Live concert. Itike yanyu ${ticketNumber} mwayibona aha ${qrUrl}. Mwaguze ${ticketPackage?.title} ticket - igura ${ticketPackage?.price} ${ticketPackage?.currency}`,
    "Shapeherd"
  )
  res.send('done')
});

export default router;

async function getToken(req: any) {
  return fetch(`${process.env.MOMO_BASE_URL}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${process.env.MOMO_BASIC_AUTH}` || "",
      "X-Reference-Id": "b12d7b22-3057-4c8e-ad50-63904171d18a",
      "Ocp-Apim-Subscription-Key": process.env.MOMO_SUBSCRIPTION_KEY || "",
      "X-Target-Environment": process.env.MOMO_ENVIRONMENT || "",
    },
  })
    .then((response) => {
      if (response.ok) {
        return response.json();
      } else {
        throw Error(response.statusText);
      }
    })
    .then((response) => {
      req.session.accessToken = response?.access_token;
      return response;
      //   req.session.momoToken = res?.access_token;
    })
    .catch((err) => {
      return { errorMessage: `${err}` };
    });
}
