import type { Language } from "./routes";

export interface TicketTextParams {
  eventTitle?: string;
  number: number;
  link: string;
  packageTitle?: string;
  price?: number;
  currency?: string;
}

/** Ticket SMS body per language; `rw` is the original text byte-for-byte. */
export function ticketText(lang: Language, p: TicketTextParams): string {
  const currency = p.currency || "RWF";
  const pkg = p.packageTitle ?? "";
  if (lang === "rw") {
    const greeting = p.eventTitle ? `Ikaze mu gitaramo ${p.eventTitle}.` : "Ikaze.";
    const price = p.price != null ? ` - igura ${p.price} ${currency}` : "";
    return `${greeting} Itike yanyu ${p.number} mwayibona aha ${p.link}. Mwaguze ${pkg} ticket${price}`;
  }
  const price = p.price != null ? ` - ${p.price} ${currency}` : "";
  if (lang === "en") {
    return `Welcome to ${p.eventTitle ?? ""}. Your ticket ${p.number} is here ${p.link}. You bought ${pkg}${price}`;
  }
  // Kirundi has no template yet; Burundi buyers read French.
  return `Bienvenue à ${p.eventTitle ?? ""}. Votre billet ${p.number} est ici ${p.link}. Vous avez acheté ${pkg}${price}`;
}
