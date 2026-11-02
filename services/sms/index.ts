import { routeFor } from "./routes";

export { smsRoutes, routeFor, languageFor, resetSmsRoutes } from "./routes";
export type { Language, SmsRoute } from "./routes";

/**
 * Fire-and-forget: picks the route for the number's country code and never
 * throws, so an SMS problem can never fail a purchase.
 */
export default function sendMessage(to: string, message: string, from?: string): void {
  const route = routeFor(to);
  if (!route) {
    console.warn(`SMS to ${to} unrouted: no route for its country code`);
    return;
  }
  route.send(to, message, from).catch((err) => console.error(`SMS to ${to} failed:`, err));
}
