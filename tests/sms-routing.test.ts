import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import sendMessage, { routeFor, languageFor, resetSmsRoutes } from "../services/sms";
import { ticketText } from "../services/sms/templates";
import { issueTickets } from "../services/tickets";
import { seedEvent } from "./helpers";
const env = { ...process.env };
beforeEach(() => { delete process.env.SMS_ROUTES; resetSmsRoutes(); });
afterEach(() => { process.env = { ...env }; resetSmsRoutes(); });

describe("sms routing", () => {
  it("legacy env makes a single 250 route in Kinyarwanda", () => {
    process.env.SMS_API_USERNAME = "u"; process.env.SMS_API_KEY = "k"; resetSmsRoutes();
    expect(routeFor("+250788123456")?.countryCode).toBe("250");
    expect(languageFor("+250788123456")).toBe("rw");
    expect(routeFor("+25768191919")).toBeUndefined();
  });
  it("SMS_ROUTES declares per-country routes with their own language", () => {
    Object.assign(process.env, { SMS_ROUTES: "250,257", SMS_250_PROVIDER: "log", SMS_257_PROVIDER: "log", SMS_257_LANG: "fr" }); resetSmsRoutes();
    expect(languageFor("+25768191919")).toBe("fr");
    expect(languageFor("+250788123456")).toBe("rw");
  });
  it("templates: rw unchanged, fr for Burundi, rn falls back to fr", () => {
    const p = { eventTitle: "Bujumbura Live", number: 10000001, link: "http://api.test/tickets/validate/10000001?showOnly=1", packageTitle: "VIP", price: 7000, currency: "BIF" };
    expect(ticketText("rw", p)).toBe("Ikaze mu gitaramo Bujumbura Live. Itike yanyu 10000001 mwayibona aha http://api.test/tickets/validate/10000001?showOnly=1. Mwaguze VIP ticket - igura 7000 BIF");
    expect(ticketText("fr", p)).toBe("Bienvenue à Bujumbura Live. Votre billet 10000001 est ici http://api.test/tickets/validate/10000001?showOnly=1. Vous avez acheté VIP - 7000 BIF");
    expect(ticketText("rn", p)).toBe(ticketText("fr", p));
  });
  it("an unrouted number does not block issue and marks the ticket", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = await seedEvent();
    const [t]: any = await issueTickets({ quantity: 1, event: event._id, ticketPackage: event.packages[0], phone: "25768191919" });
    expect(t.smsStatus).toBe("unrouted");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unrouted"));
    warn.mockRestore();
  });
  it("a routed number is sent through its route and marked sent", async () => {
    Object.assign(process.env, { SMS_ROUTES: "257", SMS_257_PROVIDER: "log", SMS_257_LANG: "fr" }); resetSmsRoutes();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = await seedEvent({ title: "Bujumbura Live" });
    const [t]: any = await issueTickets({ quantity: 1, event: event._id, ticketPackage: event.packages[0], phone: "25768191919" });
    expect(t.smsStatus).toBe("sent");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Bienvenue à Bujumbura Live"));
    log.mockRestore();
  });
});
