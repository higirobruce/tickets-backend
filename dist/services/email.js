"use strict";
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailConfigured = emailConfigured;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.sendTicketEmail = sendTicketEmail;
const tickets_1 = require("./tickets");
const format_1 = require("./format");
/** Ticket emails go out only when SMTP is configured; otherwise delivery is SMS only. */
function emailConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
}
let transporterPromise = null;
function transporter() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!transporterPromise) {
            transporterPromise = Promise.resolve().then(() => __importStar(require("nodemailer"))).then((nodemailer) => nodemailer.default.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT || 587),
                secure: process.env.SMTP_SECURE === "true",
                auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
            }));
        }
        return transporterPromise;
    });
}
function escape(text) {
    return String(text !== null && text !== void 0 ? text : "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
/** Password reset link. Resolves false when email is not configured or the send fails. */
function sendPasswordResetEmail(to, link) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!emailConfigured() || !to)
            return false;
        try {
            const mailer = yield transporter();
            yield mailer.sendMail({
                from: process.env.EMAIL_FROM,
                to,
                subject: "Reset your EvenTixr password",
                text: `Open this link to choose a new password. It works once and expires in one hour.\n${link}`,
                html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#17141a">
        <p>Open the link below to choose a new password. It works once and expires in one hour.</p>
        <p><a href="${link}" style="background:#e8541e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Choose a new password</a></p>
        <p style="color:#5d5864;font-size:13px">If you did not ask for this, you can ignore the email.</p></div>`,
            });
            return true;
        }
        catch (err) {
            console.error(`Password reset email to ${to} failed:`, err);
            return false;
        }
    });
}
/** Sends one ticket with its QR code inline. Resolves false when email is not configured or the send fails. */
function sendTicketEmail(to, ticket, event) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!emailConfigured() || !to)
            return false;
        const link = `${(0, tickets_1.webUrl)()}/tickets/${ticket._id}?showOnly=1`;
        const when = (event === null || event === void 0 ? void 0 : event.date) ? (0, format_1.formatDateTime)(event.date) : "";
        const title = (event === null || event === void 0 ? void 0 : event.title) || "Your ticket";
        const qr = typeof ticket.qrCode === "string" && ticket.qrCode.startsWith("data:image/png;base64,")
            ? Buffer.from(ticket.qrCode.slice("data:image/png;base64,".length), "base64")
            : null;
        const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#17141a">
      <h1 style="font-size:22px;margin:0 0 8px">${escape(title)}</h1>
      <p style="margin:0 0 16px;color:#5d5864">${escape(when)}${(event === null || event === void 0 ? void 0 : event.location) ? ` · ${escape(event.location)}` : ""}</p>
      <p style="margin:0 0 16px">Ticket number <strong style="font-size:20px">${escape(ticket.number)}</strong>
         · ${escape(((_a = ticket.ticketPackage) === null || _a === void 0 ? void 0 : _a.title) || "")}</p>
      ${qr ? `<p><img src="cid:ticket-qr" width="200" height="200" alt="Ticket QR code"></p>` : ""}
      <p><a href="${link}" style="background:#e8541e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Open your ticket</a></p>
      <p style="color:#5d5864;font-size:13px">Show the QR code at the gate. A screenshot works too.</p>
    </div>`;
        try {
            const mailer = yield transporter();
            yield mailer.sendMail({
                from: process.env.EMAIL_FROM,
                to,
                subject: `Your ticket ${ticket.number} for ${title}`,
                text: `${title}\n${when}\nTicket number ${ticket.number} (${((_b = ticket.ticketPackage) === null || _b === void 0 ? void 0 : _b.title) || ""})\n${link}`,
                html,
                attachments: qr ? [{ filename: `ticket-${ticket.number}.png`, content: qr, cid: "ticket-qr" }] : [],
            });
            return true;
        }
        catch (err) {
            console.error(`Ticket email to ${to} failed:`, err);
            return false;
        }
    });
}
