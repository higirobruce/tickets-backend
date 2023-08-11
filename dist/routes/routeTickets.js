"use strict";
// const QRCode = require('qrcode');
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.createTickets = exports.generateTicketNumbers = exports.generateTicketNumber = exports.createQrCode = void 0;
const qrcode_1 = __importDefault(require("qrcode"));
const express_1 = require("express");
const tickets_1 = require("../models/tickets");
const controllerTickets_1 = __importStar(require("../controllers/controllerTickets"));
const events_1 = require("../models/events");
const routeSMS_1 = __importDefault(require("./routeSMS"));
function createQrCode(param) {
    qrcode_1.default.toDataURL(param, function (err, url) {
        return url;
    });
}
exports.createQrCode = createQrCode;
function generateTicketNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        // Get the last saved document
        const lastDocument = yield tickets_1.ticketModel.findOne().sort({ number: -1 });
        // Generate a new 10-digit number, starting from 1000000000 and incrementing by 1
        let newNumber = 1000000000;
        if (lastDocument && lastDocument.number) {
            newNumber = lastDocument.number + 1;
        }
        // Return the new number
        return newNumber;
    });
}
exports.generateTicketNumber = generateTicketNumber;
function generateTicketNumbers(quantity) {
    return __awaiter(this, void 0, void 0, function* () {
        // Get the last saved document
        let totalNumber = 10000000 + (yield tickets_1.ticketModel.find().count());
        let numbers = [];
        for (let i = 0; i < quantity; i++) {
            totalNumber++;
            numbers.push(totalNumber);
        }
        return numbers;
    });
}
exports.generateTicketNumbers = generateTicketNumbers;
let router = (0, express_1.Router)();
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let tickets = yield (0, controllerTickets_1.getAllTickets)();
    res.send(tickets);
}));
router.get("/validate/:number", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    let number = req.params.number;
    // let ticket = await ticketModel.findOneAndUpdate(
    //   { number, status: Statuses.sold },
    //   { $set: { status: Statuses.consumed } },
    //   { new: true }
    // );
    let ticket = yield tickets_1.ticketModel.findOne({
        number,
        // status: { $in: [Statuses.pending, Statuses.sold] },
    });
    if (ticket)
        res.redirect(301, `https://www.eventixr.com/tickets/${ticket === null || ticket === void 0 ? void 0 : ticket._id}`);
    else
        res
            .status(404)
            .send({ erroMessage: "Ticket not found or already consumed" });
    // res.send("Tickets can not be consumed now.");
}));
router.get("/sell/:number", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let number = parseInt(req.params.number);
    let { momoRef } = req.query;
    let ticketWithSameRef = yield tickets_1.ticketModel.findOne({ momoRef });
    if (ticketWithSameRef) {
        res.statusMessage = "Momo Reference already exists";
        res.status(500).send({ erroMessage: "Momo Reference already exists" });
    }
    else {
        let ticket = yield tickets_1.ticketModel.findOneAndUpdate({ number, status: events_1.Statuses.pending }, { $set: { status: events_1.Statuses.sold, momoRef } }, { new: true });
        if (ticket)
            res.send(ticket);
        else {
            res.statusMessage = "Ticket not found or already sold";
            res.status(404).send({ erroMessage: "Ticket not found or already sold" });
        }
    }
}));
router.get("/consume/:number", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let number = parseInt(req.params.number);
    let ticket = yield tickets_1.ticketModel.findOneAndUpdate({ number, status: events_1.Statuses.pending }, { $set: { status: events_1.Statuses.consumed } }, { new: true });
    if (ticket)
        res.send(ticket);
    else
        res
            .status(404)
            .send({ erroMessage: "Ticket not found or already consumed" });
    // res.send("Tickets can not be consumed now.");
}));
router.get("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let { id } = req.params;
    let ticket = yield (0, controllerTickets_1.getTicketById)(id);
    res.send(ticket);
}));
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let number = yield generateTicketNumber();
        let { ticketPackage } = req.body;
        let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;
        let qrCode = "";
        qrcode_1.default.toDataURL(qrParam, function (err, url) {
            return __awaiter(this, void 0, void 0, function* () {
                qrCode = url;
                let ticket = yield (0, controllerTickets_1.default)({
                    number,
                    qrCode,
                    ticketPackage,
                });
                res.status(201).send(ticket);
            });
        });
    }
    catch (err) {
        res.status(500).send({ errorMessage: `${err}` });
    }
}));
router.post("/batch/:quantity", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let { quantity } = req.params;
    let tickets = [];
    res.status(201).send(yield createTickets(quantity, req, tickets, res, null));
}));
exports.default = router;
function createTickets(quantity, req, tickets, res, momoPayload) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let numbers = yield generateTicketNumbers(parseInt(quantity));
            numbers.forEach((n) => {
                let { ticketPackage } = req.body;
                // let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;
                let qrParam = `${process.env.TICKETS_BCKEND_URL}/tickets/validate/${n}`;
                let qrParam2 = `${process.env.TICKETS_BCKEND_URL}/tickets/validate/10001604`;
                let qrCode = "";
                qrcode_1.default.toDataURL(qrParam, function (err, url) {
                    qrCode = url;
                    let ticket = (0, controllerTickets_1.default)({
                        number: n,
                        qrCode,
                        ticketPackage,
                        momoPayload,
                    });
                    (0, routeSMS_1.default)("+250783575582", `You can check your ticket at ${qrParam2}. You bought a ${ticketPackage.title} ticket - ${ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage.price} ${ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage.currency} `, "EVENTIXR");
                    tickets.push(ticket);
                });
            });
            let allPromises = Promise.all(tickets);
            return allPromises
                .then((v) => {
                return v;
                // res.status(201).send(v);
            })
                .catch((err) => {
                throw Error(`${err}`);
                // res.status(500).send({ errorMessage: `${err}` });
            });
        }
        catch (err) {
            throw Error(`${err}`);
            // res.status(500).send({ errorMessage: `${err}` });
        }
    });
}
exports.createTickets = createTickets;
// QRCode.toFile(
//   "/output-file-path/file.png",
//   "Encode this text in QR code",
//   {
//     errorCorrectionLevel: "H",
//   },
//   function (err: any) {
//     if (err) throw err;
//     console.log("QR code saved!");
//   }
// );
