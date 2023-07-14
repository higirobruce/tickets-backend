import { randomUUID } from "crypto";
import { Router } from "express";
import fetch from "node-fetch";

let router = Router();

router.post("/getToken", async (req, res) => {
  let token = await getToken(req);
  res.send(token);
});

router.post("/requestToPay", async (req, res) => {
  let refId = randomUUID();
  await getToken(req);
  let paymentPayload = req.body;
  console.log(paymentPayload);

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
      res
        .status(response.status)
        .send({ statusText: response.statusText, refId, response: response.json() });
    })
    .catch((err) => {
      console.log(err);
      res.send({ errorMessage: `${err}` });
    });
});

router.get("/getStatusOfRequest/:refId", async (req, res) => {
  let { refId } = req.params;
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
    .then((response) => {
      res.send(response);
    })
    .catch((err) => {
      res.send({ errorMessage: `${err}` });
    });
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
        console.log(response);
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
