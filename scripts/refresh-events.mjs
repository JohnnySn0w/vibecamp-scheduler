// Pull the live Vibecamp .ics feed and regenerate src/events.json.
// Run via `npm run refresh:data` (or `npm run refresh` to also rebuild).
// No browser involved, so the server's missing CORS headers don't matter.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICS_URL = "https://backend-2-6ri5.onrender.com/events.ics";
const YEAR = 2026;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "events.json");

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n) => String(n).padStart(2, "0");
const unescapeIcs = (s) =>
  s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

function parseDt(v) {
  v = v.trim();
  if (v.includes("T")) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    if (!m) return { dt: null, hasTime: false };
    const [, Y, Mo, D, H, Mi, S] = m.map(Number);
    return { dt: new Date(Date.UTC(Y, Mo - 1, D, H, Mi, S)), hasTime: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return { dt: null, hasTime: false };
  const [, Y, Mo, D] = m.map(Number);
  return { dt: new Date(Date.UTC(Y, Mo - 1, D)), hasTime: false };
}

function durLabel(start, end) {
  if (!end || !start) return "";
  const totalMin = Math.round((end - start) / 60000);
  if (totalMin < 0) return "";
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const mi = totalMin % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (mi) parts.push(`${mi}m`);
  return parts.length ? parts.join(" ") : "0m";
}

// The feed is in UTC; the camp is in Maryland → display in Eastern time.
// Intl handles EST/EDT automatically per date (June = EDT, UTC-4).
const TZ = "America/New_York";
const easternFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "short",
});
function eastern(d) {
  const p = Object.fromEntries(easternFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour; // normalize midnight
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, day: p.weekday };
}

const main = async () => {
  console.log(`Fetching ${ICS_URL} …`);
  const res = await fetch(ICS_URL, { headers: { "User-Agent": "vibecamp-timeline/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();

  // unfold folded lines (continuation lines start with space/tab)
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length) lines[lines.length - 1] += raw.slice(1);
    else lines.push(raw);
  }

  const events = [];
  let cur = null;
  for (const ln of lines) {
    if (ln === "BEGIN:VEVENT") cur = {};
    else if (ln === "END:VEVENT") { if (cur) events.push(cur); cur = null; }
    else if (cur && ln.includes(":")) {
      const idx = ln.indexOf(":");
      const key = ln.slice(0, idx);
      const val = ln.slice(idx + 1);
      const prop = key.split(";")[0];
      cur[prop] = val;
      if (prop === "ORGANIZER") {
        const m = key.match(/CN=([^:;]+)/);
        if (m) cur.CN = m[1];
      }
    }
  }

  const rows = [];
  for (const e of events) {
    if (!e.DTSTART) continue;
    const { dt: start, hasTime } = parseDt(e.DTSTART);
    if (!start) continue;
    const { dt: end } = e.DTEND ? parseDt(e.DTEND) : { dt: null };

    let date, day, startStr, endStr;
    if (hasTime) {
      const es = eastern(start);               // convert UTC → Eastern (may shift the day)
      date = es.date; day = es.day; startStr = es.time;
      endStr = end ? eastern(end).time : "";
    } else {
      // genuine all-day (date-only) events are floating — do not shift across zones
      date = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
      day = DAYS[(start.getUTCDay() + 6) % 7];
      startStr = "all-day"; endStr = "";
    }
    if (!date.startsWith(String(YEAR))) continue; // filter on the Eastern-local year

    rows.push({
      date, day, start: startStr, end: endStr,
      dur: durLabel(start, end),
      summary: unescapeIcs(e.SUMMARY || "").replace(/\n/g, " ").trim(),
      location: unescapeIcs(e.LOCATION || "").trim(),
      desc: unescapeIcs(e.DESCRIPTION || "").trim(),
      org: (e.CN || "").trim(),
      iso: start.toISOString().replace(/\.000Z$/, "Z"), // UTC instant, for chronological sort
    });
  }
  rows.sort((a, b) => a.iso.localeCompare(b.iso));

  writeFileSync(OUT, JSON.stringify(rows, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${rows.length} ${YEAR} events → ${OUT}`);
};

main().catch((err) => {
  console.error("Refresh failed:", err.message);
  process.exit(1);
});
