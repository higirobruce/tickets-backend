import { africasTalking } from "./africastalking";
import { send as logSend } from "./log";

export type Language = "rw" | "fr" | "rn" | "en";

export interface SmsRoute {
  countryCode: string;
  language: Language;
  senderId?: string;
  /** `from` is the caller's sender, used only when the route has no senderId. */
  send(to: string, text: string, from?: string): Promise<void>;
}

const LANGUAGES: Language[] = ["rw", "fr", "rn", "en"];
const DEFAULT_LANGUAGE: Record<string, Language> = { "250": "rw", "257": "fr" };

let cached: SmsRoute[] | null = null;

function parseLanguage(countryCode: string, value?: string): Language {
  if (!value) return DEFAULT_LANGUAGE[countryCode] ?? "en";
  const lang = value.trim().toLowerCase() as Language;
  return LANGUAGES.includes(lang) ? lang : "en";
}

/** Today's single Africa's Talking setup, kept so existing deployments need no env change. */
function legacyRoute(): SmsRoute {
  const env = process.env;
  return {
    countryCode: "250",
    language: "rw",
    senderId: env.SMS_SENDER_ID || undefined,
    send: africasTalking({
      username: env.SMS_API_USERNAME,
      apiKey: env.SMS_API_KEY,
      senderId: env.SMS_SENDER_ID || undefined,
      fallbackNumber: env.SMS_FALLBACK_NUMBER || undefined,
      credentialEnv: "SMS_API_KEY and SMS_API_USERNAME",
    }),
  };
}

function countryRoute(countryCode: string): SmsRoute {
  const env = process.env;
  const key = (name: string) => env[`SMS_${countryCode}_${name}`] || undefined;
  const senderId = key("SENDER_ID");
  const provider = (key("PROVIDER") || "africastalking").toLowerCase();
  const send = provider === "log"
    ? logSend
    : africasTalking({
      username: key("USERNAME"),
      apiKey: key("API_KEY"),
      senderId,
      fallbackNumber: key("FALLBACK_NUMBER"),
      credentialEnv: `SMS_${countryCode}_USERNAME and SMS_${countryCode}_API_KEY`,
    });
  return { countryCode, language: parseLanguage(countryCode, key("LANG")), senderId, send };
}

/** Routes from env, built once; `SMS_ROUTES` unset means the legacy Rwanda-only route. */
export function smsRoutes(): SmsRoute[] {
  if (cached) return cached;
  const codes = (process.env.SMS_ROUTES || "")
    .split(",")
    .map((c) => c.replace(/\D/g, ""))
    .filter(Boolean);
  cached = codes.length ? codes.map(countryRoute) : [legacyRoute()];
  return cached;
}

/** Forgets the cached routes so the next call re-reads env (tests). */
export function resetSmsRoutes() {
  cached = null;
}

/** Longest country code that prefixes the number's digits wins. */
export function routeFor(to: string): SmsRoute | undefined {
  const digits = String(to).replace(/\D/g, "");
  let best: SmsRoute | undefined;
  for (const route of smsRoutes()) {
    if (digits.startsWith(route.countryCode) && route.countryCode.length > (best?.countryCode.length ?? 0)) {
      best = route;
    }
  }
  return best;
}

export function languageFor(to: string): Language {
  return routeFor(to)?.language ?? "rw";
}
