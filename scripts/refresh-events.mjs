// Pull the live Vibecamp .ics feed and regenerate src/events.json.
// Run via `npm run refresh:data` (or `npm run refresh` to also rebuild).
// No browser involved, so the server's missing CORS headers don't matter.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICS_URL = "https://backend-2-6ri5.onrender.com/events.ics";
const YEAR = 2026;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "events.json");
// Rolling baseline of event UIDs. Built up on every run through June 17 (the
// "tracking window"); frozen from June 18 onward, when any UID not already in it
// is flagged `new:true` so the site can show a "New" pill on late additions.
const BASELINE = join(ROOT, "src", "known-events.json");
const NEW_FROM = "2026-06-18"; // first Eastern date that earns "New" pills

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n) => String(n).padStart(2, "0");
const unescapeIcs = (s) =>
  s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

// Parse an iCalendar date(-time). The feed now emits FLOATING local times
// (no trailing Z, no TZID) — the raw wall-clock at the camp venue (Eastern).
// We still handle trailing-Z (UTC instant) values for robustness / old caches.
// `dt` is a naive Date built from the components (UTC fields == the written
// numbers); good for duration math and chronological sort regardless of zone.
function parseDt(v) {
  v = v.trim();
  if (v.includes("T")) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
    if (!m) return { dt: null, hasTime: false };
    const Y = +m[1], Mo = +m[2], D = +m[3], H = +m[4], Mi = +m[5], S = +m[6];
    return {
      dt: new Date(Date.UTC(Y, Mo - 1, D, H, Mi, S)),
      hasTime: true, isUTC: m[7] === "Z",
      Y, Mo, D, H, Mi,
    };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return { dt: null, hasTime: false };
  const Y = +m[1], Mo = +m[2], D = +m[3];
  return { dt: new Date(Date.UTC(Y, Mo - 1, D)), hasTime: false, isUTC: false, Y, Mo, D };
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
    const ps = parseDt(e.DTSTART);
    if (!ps.dt) continue;
    const pe = e.DTEND ? parseDt(e.DTEND) : null;
    const start = ps.dt, end = pe ? pe.dt : null;

    let date, day, startStr, endStr;
    if (ps.hasTime && ps.isUTC) {
      // legacy UTC instant (trailing Z) → convert to Eastern (may shift the day)
      const es = eastern(start);
      date = es.date; day = es.day; startStr = es.time;
      endStr = end ? eastern(end).time : "";
    } else if (ps.hasTime) {
      // floating local time: the written wall-clock IS Eastern (camp venue) —
      // emit it verbatim, no zone conversion (that was the 4h-early bug).
      date = `${ps.Y}-${pad(ps.Mo)}-${pad(ps.D)}`;
      day = DAYS[(start.getUTCDay() + 6) % 7];
      startStr = `${pad(ps.H)}:${pad(ps.Mi)}`;
      endStr = pe && pe.hasTime ? `${pad(pe.H)}:${pad(pe.Mi)}` : "";
    } else {
      // genuine all-day (date-only) events are floating — do not shift across zones
      date = `${ps.Y}-${pad(ps.Mo)}-${pad(ps.D)}`;
      day = DAYS[(start.getUTCDay() + 6) % 7];
      startStr = "all-day"; endStr = "";
    }
    if (!date.startsWith(String(YEAR))) continue; // filter on the local year

    rows.push({
      date, day, start: startStr, end: endStr,
      dur: durLabel(start, end),
      summary: unescapeIcs(e.SUMMARY || "").replace(/\n/g, " ").trim(),
      location: unescapeIcs(e.LOCATION || "").trim(),
      desc: unescapeIcs(e.DESCRIPTION || "").trim(),
      org: (e.CN || "").trim(),
      iso: start.toISOString().replace(/\.000Z$/, "Z"), // UTC instant, for chronological sort
      uid: (e.UID || "").trim(),
    });
  }
  rows.sort((a, b) => a.iso.localeCompare(b.iso));

  // Stable identity per event: prefer the feed UID, fall back to a content key.
  const keyOf = (r) => r.uid || `${r.summary}@@${r.iso}@@${r.location}`;

  // What's "today" in camp-local (Eastern) terms — that's what gates the window.
  // VC_TODAY (YYYY-MM-DD) overrides it for testing the New-pill behavior.
  const todayET = process.env.VC_TODAY || eastern(new Date()).date;
  const tracking = todayET < NEW_FROM;

  // Load the rolling baseline of known UIDs (empty on first ever run).
  let baseline = new Set();
  if (existsSync(BASELINE)) {
    try { baseline = new Set(JSON.parse(readFileSync(BASELINE, "utf-8")).uids || []); }
    catch { /* corrupt/missing → start fresh */ }
  }

  if (tracking) {
    // Still pre-June-18: fold every current event into the baseline and persist it.
    const before = baseline.size;
    for (const r of rows) baseline.add(keyOf(r));
    writeFileSync(
      BASELINE,
      JSON.stringify({ note: `Event UIDs known on/before ${NEW_FROM}; frozen from then on.`, updated: todayET, count: baseline.size, uids: [...baseline].sort() }, null, 2) + "\n",
      "utf-8",
    );
    for (const r of rows) r.new = false;
    console.log(`Tracking window (today ${todayET} < ${NEW_FROM}): baseline ${before} → ${baseline.size} UIDs. No "New" pills yet.`);
  } else {
    // June 18+: baseline is frozen; anything not in it is New.
    let n = 0;
    for (const r of rows) { r.new = !baseline.has(keyOf(r)); if (r.new) n++; }
    console.log(`Live window (today ${todayET} ≥ ${NEW_FROM}): ${n} of ${rows.length} flagged New against a ${baseline.size}-UID baseline.`);
  }

  // UID was only needed for identity; drop it from the shipped JSON.
  for (const r of rows) delete r.uid;

  writeFileSync(OUT, JSON.stringify(rows, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${rows.length} ${YEAR} events → ${OUT}`);
};

main().catch((err) => {
  console.error("Refresh failed:", err.message);
  process.exit(1);
});
