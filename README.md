# zorua

A web app for TCG sellers to keep their sticker prices in sync with the market.

Upload a CSV inventory export (card name, set, card code, price, etc.), and
the app looks up each card's current market price via the Pokémon TCG API,
applies a condition-based adjustment (NM/LP/MP/HP), and shows the old vs.
new price in a results table. Download the updated CSV to re-import into
your inventory system.

## Structure

- `index.html`, `main.js`, `parser.js`, `fetcher.js`, `pricer.js`, `style.css` — the static frontend (upload, table, CSV parsing/export).
- `api/card.js` — a Vercel serverless function that proxies card lookups to
  the Pokémon TCG API, keeping the API key server-side.

## Running locally

```
vercel dev
```

Requires a `.env` file with `POKEMONTCG_API_KEY` set (see `.env.example`).
