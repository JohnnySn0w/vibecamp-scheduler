# vccal — Vibecamp calendar Worker

A tiny, **stateless** Cloudflare Worker at `vccal.mahan.io` that returns a posted
schedule as `text/calendar`. It exists only so browsers get a real
`Content-Type: text/calendar` header (which a static host can't set on a dynamic
file) — that's what makes iOS Safari show the native "Add to Calendar" sheet and
every other browser download a clean, properly-named `.ics`.

The main site stays 100% static; this is a separate one-route helper.

## How it works

The site builds the `.ics` client-side, gzip + base64url-encodes it, and
navigates to:

```
https://vccal.mahan.io/vibecamp-schedule.ics?d=<encoded>
```

The Worker decodes, validates it's a `BEGIN:VCALENDAR`, and echoes it back with
calendar headers. Nothing is stored; the events live in the URL only.

`GET /` (no `d`) returns `ok` — the site pings this to check the Worker is live
before using it, so until you deploy this, the site silently falls back to its
client-side download.

## Deploy (Wrangler)

```bash
cd worker
npx wrangler login          # one-time, opens browser to authorize
npx wrangler deploy         # deploys + binds vccal.mahan.io (DNS + cert auto-created)
```

The `custom_domain` route in `wrangler.toml` creates the `vccal.mahan.io` record
and certificate for you (mahan.io is already on your Cloudflare account).

### Verify

```bash
curl -s "https://vccal.mahan.io/?ping=1"          # -> ok
curl -sI "https://vccal.mahan.io/x.ics?d=BAD" | head -1   # -> 400 (rejects junk)
```

Once `?ping=1` returns `ok`, the live site will automatically start using the
Worker for the "Add to calendar" export — no site redeploy needed.

## Deploy (Dashboard alternative)

1. Workers & Pages → Create → Worker → paste `src/index.js` → Deploy.
2. The new Worker → Settings → Domains & Routes → Add → Custom domain →
   `vccal.mahan.io`.

## Safety notes

- Stateless; no storage, no logging of payloads.
- Only serves `text/calendar` as an **attachment** (never inline HTML) — no XSS surface.
- Caps input (64 KB) and decompressed output (1 MB) to avoid decompression bombs.
- CORS `*` is fine: it only ever returns calendar text the caller already supplied.
