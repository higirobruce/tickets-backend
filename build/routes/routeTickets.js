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
exports.generateTicketNumber = exports.createQrCode = void 0;
const qrcode_1 = __importDefault(require("qrcode"));
const express_1 = require("express");
const tickets_1 = require("../models/tickets");
const controllerTickets_1 = __importStar(require("../controllers/controllerTickets"));
const events_1 = require("../models/events");
function createQrCode(param) {
    qrcode_1.default.toDataURL(param, function (err, url) {
        return url;
    });
}
exports.createQrCode = createQrCode;
const generateTicketNumber = () => __awaiter(void 0, void 0, void 0, function* () {
    // Get the last saved document
    const lastDocument = yield tickets_1.ticketModle.findOne().sort({ number: -1 });
    // Generate a new 10-digit number, starting from 1000000000 and incrementing by 1
    let newNumber = 1000000000;
    if (lastDocument && lastDocument.number) {
        newNumber = lastDocument.number + 1;
    }
    // Return the new number
    return newNumber;
});
exports.generateTicketNumber = generateTicketNumber;
let router = (0, express_1.Router)();
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let tickets = yield (0, controllerTickets_1.getAllTickets)();
    res.send(tickets);
}));
router.get("/validate/:number", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let number = req.params.number;
    let ticket = yield tickets_1.ticketModle.findOneAndUpdate({ number, status: events_1.Statuses.pending }, { $set: { status: events_1.Statuses.consumed } }, { new: true });
    if (ticket)
        res.send(ticket);
    else
        res.status(404).send({ erroMessage: 'Ticket not found or already consumed' });
}));
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let number = yield (0, exports.generateTicketNumber)();
        let { ticketPackage } = req.body;
        let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;
        let qrCode = "";
        qrcode_1.default.toDataURL(qrParam, function (err, url) {
            return __awaiter(this, void 0, void 0, function* () {
                qrCode = url;
                console.log(qrCode);
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
exports.default = router;
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
