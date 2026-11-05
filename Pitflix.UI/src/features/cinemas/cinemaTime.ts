/** Time helpers for the Cinemas Schedule. Both chains schedule in Cairo time regardless of where the app runs. */

export function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

export function cairoNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** "1:30pm" / "01:30 PM" → minutes since the start of the cinema day; small-hours shows count as late night. */
export function showtimeMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(time.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  else if (h < 6) h += 24;
  return h * 60 + Number(m[2]);
}

/** Both chains' spellings ("1:30pm", "01:30 PM") → "1:30 PM". */
export function displayTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(time.trim());
  return m ? `${Number(m[1])}:${m[2]} ${m[3].toUpperCase()}` : time;
}

export function inMinutes(mins: number): string {
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

export const fmtCinemaDate = (isoDate: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
