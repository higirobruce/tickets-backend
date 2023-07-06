import { Router } from "express";
import fetch from "node-fetch";

let router = Router();

router.post("/getToken", async (req, res) => {
  fetch("https://sandbox.momodeveloper.mtn.com/collection/token/", {
    method: "POST",
    headers: {
      Authorization: process.env.MOMO_BASIC_AUTH || "",
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
        res.send(response)
      console.log(response);
      //   req.session.momoToken = res?.access_token;
    })
    .catch((err) => {
        console.log(err);
      res.status(500).send({ errorMessage: `${err}` });
    });
});

export default router;
