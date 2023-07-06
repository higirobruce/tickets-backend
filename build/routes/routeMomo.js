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
const express_1 = require("express");
const node_fetch_1 = __importDefault(require("node-fetch"));
let router = (0, express_1.Router)();
router.post("/getToken", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    (0, node_fetch_1.default)("https://sandbox.momodeveloper.mtn.com/collection/token/", {
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
        }
        else {
            throw Error(response.statusText);
        }
    })
        .then((response) => {
        res.send(response);
        console.log(response);
        //   req.session.momoToken = res?.access_token;
    })
        .catch((err) => {
        console.log(err);
        res.status(500).send({ errorMessage: `${err}` });
    });
}));
exports.default = router;
