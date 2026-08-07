# portfolio-tracker

A single-page holdings tracker for stocks and ETFs, with live quotes served by a
Cloudflare Worker. No build step, no framework, no backend database — the app is one
HTML file and your data stays in the browser.

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
| `index.html` | The whole app — markup, styles and logic in one file. |
| `site/index.html` | Deploy copy served by Cloudflare Pages. |
| `src/index.js` | Worker backing `/api/quote`, deployed via `wrangler.toml`. |
| `quote-worker.js` | Earlier standalone version of the quote worker. |
| `DESIGN-SYSTEM.md` | Design tokens and the notes from the Code design-system migration. |

## Running it

The app is static, so anything that serves a file will do:

```bash
python3 -m http.server 8000
```

Live quotes need the worker. Deploy it once:

```bash
npx wrangler deploy
```

Then add the route `portfolio.matteocurcio.com/api/*` under Workers → Settings →
Domains & Routes. The app already calls `/api/quote`, so nothing else needs configuring.
Quotes are cached for 60 seconds and the worker accepts up to 50 symbols per batch.

## Your data

Portfolio data is personal, so it is **not** in this repo — `.gitignore` excludes
`portfolio-*.json`. Transactions live in browser storage and are exported and imported as
JSON from the app itself. If you fork this, keep it that way: once real holdings land in
git history they're very hard to remove.

## Design

Dark-first, light theme via `html.theme-light`. One accent colour meaning active, selected
or primary; `--c-danger` reserved for loss and destructive actions; every number is
monospaced. See [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) for the token set and the rules.
