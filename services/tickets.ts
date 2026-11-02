import QRCode from "qrcode";
import { ticketModel } from "../models/tickets";
import { eventModel } from "../models/events";
import createTicket from "../controllers/controllerTickets";
import sendMessage from "../services/sms";
// Routing helpers come from ./sms/routes, not the index, because tests mock the index with only a default export.
import { languageFor, routeFor, type Language } from "./sms/routes";
import { ticketText } from "./sms/templates";
import { emailConfigured, sendTicketEmail } from "./email";

export const TICKET_NUMBER_START = 10000000;
const DUPLICATE_KEY = 11000;
const MAX_NUMBER_RETRIES = 5;

export function backendUrl() {
  return (process.env.TICKETS_BCKEND_URL || "http://localhost:8081").replace(/\/$/, "");
}

/** Public web app that ticket links and QR redirects point at. */
export function webUrl() {
  return (process.env.TICKETS_WEB_URL || "https://www.eventixr.com").replace(/\/$/, "");
}

export function validateUrl(number: number, showOnly = false) {
  const base = `${backendUrl()}/tickets/validate/${number}`;
  return showOnly ? `${base}?showOnly=1` : base;
}

export async function nextTicketNumber() {
  const last = await ticketModel.findOne().sort({ number: -1 }).select("number");
  return Math.max(TICKET_NUMBER_START, (last?.number ?? 0) + 1);
}

export function ticketSms(eventTitle: string | undefined, number: number, ticketPackage: any, language: Language = "rw") {
  return ticketText(language, {
    eventTitle,
    number,
    link: validateUrl(number, true),
    packageTitle: ticketPackage?.title,
    price: ticketPackage?.price,
    currency: ticketPackage?.currency,
  });
}

export function phoneFromPayload(momoPayload: any): string | undefined {
  const partyId = momoPayload?.payer?.partyId;
  return partyId ? String(partyId) : undefined;
}

export function toInternational(phone?: string | null) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : undefined;
}

export interface IssueOptions {
  quantity: number;
  ticketPackage?: any;
  event?: any;
  momoPayload?: any;
  momoRef?: string;
  /** Phone in MSISDN form, e.g. 250788123456. Defaults to the payer. */
  phone?: string;
  /** Provider-neutral payment details, stored on every ticket. */
  payment?: { provider: string; ref?: string; amount?: number; currency?: string; phone?: string };
  buyer?: { name?: string | null; email?: string | null } | null;
  complimentary?: boolean;
  note?: string;
}

/**
 * Creates `quantity` tickets, waits for every save, then sends one SMS per
 * ticket when there is a phone to send to. Returns the saved documents.
 */
export async function issueTickets(options: IssueOptions) {
  const quantity = Math.max(1, Math.floor(Number(options.quantity) || 1));
  const eventDoc = options.event ? await eventModel.findById(options.event) : null;
  const eventId = eventDoc?._id ?? (options.event || undefined);
  const phone = toInternational(options.phone ?? options.payment?.phone ?? phoneFromPayload(options.momoPayload));
  const language = phone ? languageFor(phone) : "rw";
  // Recorded on the ticket so support can see why a buyer got no SMS.
  const smsStatus = !phone ? "none" : routeFor(phone) ? "sent" : "unrouted";

  const saved: any[] = [];
  for (let i = 0; i < quantity; i++) {
    saved.push(await createWithFreshNumber({
      ticketPackage: options.ticketPackage,
      event: eventId,
      momoPayload: options.momoPayload,
      momoRef: options.momoRef,
      payment: options.payment,
      buyer: options.buyer || undefined,
      complimentary: Boolean(options.complimentary),
      note: options.note,
      smsStatus,
    }));
  }

  if (phone) {
    for (const ticket of saved) {
      sendMessage(phone, ticketSms(eventDoc?.title, ticket.number, options.ticketPackage, language), "EVENTIXR");
    }
  }
  const email = options.buyer?.email;
  if (email && emailConfigured()) {
    for (const ticket of saved) {
      await sendTicketEmail(email, ticket, eventDoc);
    }
  }

  return saved;
}

async function createWithFreshNumber(fields: any) {
  for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
    const number = await nextTicketNumber();
    const qrCode = await QRCode.toDataURL(validateUrl(number));
    try {
      return await createTicket({ number, qrCode, ...fields });
    } catch (err: any) {
      if (err?.code !== DUPLICATE_KEY) throw err;
    }
  }
  throw new Error("Could not allocate a unique ticket number");
}
