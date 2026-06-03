# Vibecamp Scheduler

An interactive, single-page **timeline of the Vibecamp 2026 schedule** — built with
[Astro](https://astro.build), themed with Catppuccin Mocha, and deployed as a fully
static site to GitHub Pages.

The whole year sits on one continuous, horizontally-scrolling track: time runs left → right,
overlapping events stack into parallel lanes, and multi-day events span across the day columns.
You can click events to read details, build a personal schedule, review time conflicts, and
export it to PDF (via the browser's print-to-PDF).

## Data: live calendar, static output

The event data comes from the live Vibecamp `.ics` feed. Because that server doesn't send
CORS headers, the browser can't fetch it directly — so instead the feed is pulled **at build
time** and baked into the static HTML. The published page never touches the network.

- `npm run refresh:data` — pull the live feed and regenerate `src/events.json`
- `npm run refresh` — refresh the data **and** rebuild the site
- The deploy workflow runs the refresh on every build **and on a daily cron**, so the
  published site stays current on its own.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # output static site to dist/
npm run preview    # serve the built dist/ locally
```

The build is dependency-free output: `dist/index.html` is self-contained (CSS + JS inlined,
no external assets) and can even be opened directly from disk.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds (pulling fresh
calendar data) and deploys to GitHub Pages. Enable it once under
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

### Custom domain

To serve from a custom subdomain, add a `public/CNAME` file containing the domain
(e.g. `vibecamp.example.com`) and point a DNS `CNAME` record at `johnnysn0w.github.io`.
