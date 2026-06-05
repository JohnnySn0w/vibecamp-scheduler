// vccal.mahan.io — tiny, stateless calendar endpoint for the Vibecamp scheduler.
//
// The static site (vibecamp.mahan.io) builds an .ics from the user's picks,
// gzips + base64url-encodes it, and navigates to:
//     https://vccal.mahan.io/vibecamp-schedule.ics?d=<encoded>
// This Worker decodes it and returns it with a real `Content-Type: text/calendar`
// header — the one thing a static host can't set on a dynamic file. That header
// is what makes browsers hand the .ics to the calendar (iOS Safari shows the
// native "Add to Calendar" sheet; everything else gets a clean named download).
//
// Stateless: nothing is stored. The events ride in the URL and are echoed back.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_INPUT = 64 * 1024;        // reject oversized payloads
const MAX_OUTPUT = 1024 * 1024;     // 1 MB decompressed cap (anti decompression-bomb)

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += "=".repeat(pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzipCapped(bytes) {
  const ds = new DecompressionStream("gzip");
  const reader = new Response(bytes).body.pipeThrough(ds).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_OUTPUT) throw new Error("output too large");
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return new TextDecoder().decode(buf);
}

export default {
  async fetch(request) {
    const isHead = request.method === "HEAD";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET" && !isHead) return new Response("Method not allowed", { status: 405, headers: CORS });

    const url = new URL(request.url);
    const d = url.searchParams.get("d");

    // Health check — the site pings this to know the Worker is up before using it.
    if (!d) {
      return new Response(isHead ? null : "ok", { status: 200, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
    }

    if (d.length > MAX_INPUT) return new Response("Payload too large", { status: 413, headers: CORS });

    let ics;
    try {
      ics = await gunzipCapped(b64urlToBytes(d));
    } catch (e) {
      return new Response("Bad request", { status: 400, headers: CORS });
    }

    // Only ever serve calendar data, as an attachment (never inline HTML) — no XSS surface.
    if (!ics.startsWith("BEGIN:VCALENDAR")) return new Response("Bad request", { status: 400, headers: CORS });

    return new Response(isHead ? null : ics, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
        "Content-Disposition": 'attachment; filename="vibecamp-schedule.ics"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
