"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const express_1 = require("express");
const node_fetch_1 = __importDefault(require("node-fetch"));
const routeTickets_1 = require("./routeTickets");
let router = (0, express_1.Router)();
router.post("/getToken", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let token = yield getToken(req);
    res.send(token);
}));
router.post("/requestToPay", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let refId = (0, crypto_1.randomUUID)();
    yield getToken(req);
    let paymentPayload = req.body;
    req.session.paymentPayload = paymentPayload;
    (0, node_fetch_1.default)(`${process.env.MOMO_BASE_URL}/collection/v1_0/requesttopay`, {
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
}));
router.get("/statusOfRequest/:refId", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let { refId } = req.params;
    let { title, price, currency } = req.query;
    yield getToken(req);
    (0, node_fetch_1.default)(`${process.env.MOMO_BASE_URL}/collection/v1_0/requesttopay/${refId}`, {
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
        }
        else {
            res.status(response.status).send(response.statusText);
        }
    })
        .then((response) => __awaiter(void 0, void 0, void 0, function* () {
        let tickets = [];
        if (response.status === "SUCCESSFUL") {
            console.log("Payment session:", req.session);
            req.body.paymentPayload = req.session.paymentPayload;
            req.body.ticketPackage = { title, price, currency };
            yield (0, routeTickets_1.createTickets)("1", req, tickets, res, response);
            res.send(response);
        }
        else {
            res.send(response);
        }
    }))
        .catch((err) => {
        res.send({ errorMessage: `${err}` });
    });
}));
exports.default = router;
function getToken(req) {
    return __awaiter(this, void 0, void 0, function* () {
        return (0, node_fetch_1.default)(`${process.env.MOMO_BASE_URL}/collection/token/`, {
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
            }
            else {
                throw Error(response.statusText);
            }
        })
            .then((response) => {
            req.session.accessToken = response === null || response === void 0 ? void 0 : response.access_token;
            return response;
            //   req.session.momoToken = res?.access_token;
        })
            .catch((err) => {
            return { errorMessage: `${err}` };
        });
    });
}
