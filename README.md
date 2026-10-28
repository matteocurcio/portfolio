# portfolio-tracker

A single-page holdings tracker for stocks and ETFs. One Cloudflare Worker serves the page,
live quotes and the portfolio data, which lives in D1 (the shared `app-data` database).
The whole site sits behind Cloudflare Access. No build step, no framework.

Runs at [portfolio.matteocurcio.com](https://portfolio.matteocurcio.com).

## What it does

- Track buy and sell transactions per ticker, with fees.
- Derive holdings, average cost, market value and unrealised gain/loss.
- Pull live prices from Yahoo Finance through a same-origin `/api/quote` endpoint,
  so the browser never hits a CORS wall and there's no dependency on public proxies.
- Sortable holdings and transaction tables, allocation doughnut, dark and light themes.

## Layout

| Path | What it is |
| --- | --- |
| `site/index.html` | The whole app: markup, styles and logic in one file. Bundled into the Worker as text. |
| `index.html` | Copy of `site/index.html`; keep the two identical. |
| `src/index.js` | Worker: Access gate, page, `/api/quote`, `/api/state`. |
| `src/access.js` | Access JWT check, same code as bill and inventory. Fails closed. |
| `migrations/` | D1 schema. Tables are prefixed `portfolio_`. |
| `wrangler.jsonc` | Worker `portfolio`, custom domain, D1 binding, Access vars. |
| `deployment/access.json` | The Access application this Worker trusts. |
| `DESIGN-SYSTEM.md` | Design tokens and the notes from the Code design-system migration. |

## Endpoints

- `GET /api/quote?symbol=X` or `?symbols=X,Y` — live prices from Yahoo Finance, cached 60 s, max 50 symbols.
- `GET /api/history?from=YYYY-MM-DD&symbols=A,B` — daily closes since `from`. Closes are kept in D1; Yahoo is
  only asked for days not stored yet (plus FX to AUD for holdings quoted in another currency).
- `GET /api/state` — `{ doc, version }`; `doc` is null until the first save.
- `GET|POST /api/archive` — list or add a reference copy (`{ label, note, doc }`).
- `PUT /api/state` with `{ version, doc }` — saves when `version` is still current, otherwise
  `409` with the stored copy. Every replaced copy goes to `portfolio_history` (last 200 kept).

## Storage

Data lives in D1 `app-data` (shared with bill, expenses, recipes, scripts and shortcuts):

- `portfolio_state` — one row, the whole portfolio as JSON, with a version number.
- `portfolio_archive` — old exports kept for reference, never live: the EUR-based history from before the
  AUD rebase (`portfolio-2026-06-12.json`). `GET /api/archive` lists them, `?id=N` returns one.
- `portfolio_prices` / `portfolio_price_sync` — daily closes per symbol and how far each has been fetched.
  The chart rebuilds value and cost for every trading day from the trades plus these closes, so
  editing or back-dating a trade redraws the past; only the prices are stored, not the totals.
- `portfolio_history` — previous versions, for undoing a bad edit:
  `SELECT version, saved_at FROM portfolio_history ORDER BY id DESC LIMIT 20;`

The Worker creates both tables on first use; `migrations/0001_portfolio.sql` is the same SQL for
`wrangler d1 migrations apply app-data --remote`. The browser keeps a cache in localStorage so the page
draws instantly and edits made offline are sent on the next save. A browser's old local-only data is
never uploaded automatically; an empty database is filled on purpose with Import.
Export/Import JSON still works as a manual backup.

## Access

`portfolio.matteocurcio.com` is a self-hosted Access application using the reusable policy `me`
(details in `deployment/access.json`). The Worker also verifies the `Cf-Access-Jwt-Assertion` token
against `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, so a missing or misconfigured Access app means no data
rather than open data. `workers_dev` and preview URLs are off: the custom domain is the only way in.

## Deploy

```bash
npx wrangler deploy
```

Local: put `DEV_OPEN=1` in `.dev.vars` (never in production), then `npx wrangler dev`.

## Your data

Portfolio data is personal, so it is **not** in this repo: `.gitignore` excludes `portfolio-*.json`
and this repo is public. Holdings live only in D1.

## Design

Dark-first, light theme via `html.theme-light`. One accent colour meaning active, selected
or primary; `--c-danger` reserved for loss and destructive actions; every number is
monospaced. See [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) for the token set and the rules.
