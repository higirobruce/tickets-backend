const TZ = process.env.EVENT_TIMEZONE || "Africa/Kigali";

/** "Sun 25 Oct 2026, 17:00" in the event timezone. */
export function formatDateTime(value: any) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
}

/** "2026-10-25 17:00" for spreadsheets. */
export function formatStamp(value: any) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
