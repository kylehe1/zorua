// fetcher.js
// Single responsibility: talk to our backend proxy (/api/card), which in
// turn talks to the Pokémon TCG API (pokemontcg.io v2). The real API key
// lives server-side only (see api/card.js) and never reaches the browser.
// No DOM access and no pricing math here — just fetch + shape the response.

const API_BASE_URL = "/api/card";

// Give up on a single search call after this long so one slow/hung request
// can't stall the whole inventory run.
const SEARCH_TIMEOUT_MS = 8000;

// api.pokemontcg.io is flaky under load (timeouts, stray 404/5xx on valid
// queries), so a search gets a few attempts with backoff before we give up
// and report the row as failed.
const MAX_SEARCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 750;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The inventory sheet has no "finish" column, so we don't know up front
// whether a card is normal/holo/reverse holo/etc. Instead, once we find
// the matching card, we try its TCGplayer price finishes in this priority
// order and use whichever one is actually present.
const PRICE_KEY_PRIORITY = [
  "holofoil",
  "reverseHolofoil",
  "1stEditionHolofoil",
  "normal",
  "1stEditionNormal",
  "unlimitedHolofoil",
  "unlimited",
];

// Builds the search query URL for a given card name and set name, using
// the proxy's own params (name, set) rather than pokemontcg.io's raw
// Lucene "q" syntax — the proxy (api/card.js) builds that query itself.
function buildSearchUrl(cardName, setName) {
  const params = new URLSearchParams({ name: cardName, set: setName });
  return `${API_BASE_URL}?${params.toString()}`;
}

// Fallback for when name+set turns up nothing: vendor sheets sometimes use
// a card name that doesn't match the API's name (e.g. a promo/variant
// naming quirk), but the set + card number still pins down the exact card.
function buildNumberSearchUrl(setName, cardNumber) {
  const params = new URLSearchParams({ set: setName, number: cardNumber });
  return `${API_BASE_URL}?${params.toString()}`;
}

// "103/106" -> "103". Card codes in the sheet are "<number>/<set size>";
// the API's own `number` field is just the first part, so this lets us
// disambiguate between multiple printings that share a name/set.
function extractCardNumber(cardCode) {
  if (!cardCode) return "";
  return cardCode.split("/")[0].trim().replace(/^0+(?=\d)/, "");
}

// Given all name/set matches, prefers the one whose card number matches
// the sheet's card code (ignoring leading zeros); falls back to the first
// match if there's no code or no exact number match.
function pickBestMatch(matches, cardCode) {
  const wantedNumber = extractCardNumber(cardCode);
  if (!wantedNumber) return matches[0];

  const exact = matches.find(
    (card) => String(card.number || "").replace(/^0+(?=\d)/, "") === wantedNumber
  );
  return exact || matches[0];
}

// Picks the first available finish price (by PRICE_KEY_PRIORITY) from a
// card's tcgplayer.prices block.
function pickMarketPrice(card) {
  const prices = card.tcgplayer?.prices;
  if (!prices) return { price: undefined, finish: undefined };

  for (const key of PRICE_KEY_PRIORITY) {
    const market = prices[key]?.market;
    if (market !== undefined && market !== null) {
      return { price: market, finish: key };
    }
  }
  return { price: undefined, finish: undefined };
}

// Runs a search against the proxy and returns either { matches } or
// { error } shaped as a fetchCardMarketPrice failure outcome. Aborts and
// reports a timeout error if the call takes longer than SEARCH_TIMEOUT_MS.
async function searchCards(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (networkError) {
    if (networkError.name === "AbortError") {
      return { error: { status: "error", message: `Timed out after ${SEARCH_TIMEOUT_MS / 1000}s` } };
    }
    return { error: { status: "error", message: `Network error: ${networkError.message}` } };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return { error: { status: "error", message: `API returned ${response.status}` } };
  }

  const body = await response.json();
  return { matches: body.data };
}

// Wraps searchCards with a few retries (with backoff) before giving up,
// since a single timeout/404/5xx from the upstream API is often transient.
async function searchCardsWithRetry(url) {
  let result;
  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
    result = await searchCards(url);
    if (!result.error) return result;
    if (attempt < MAX_SEARCH_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  return result;
}

// Fetches the best-matching card for a given name/set/card code and
// returns its TCGplayer market price (trying finishes in priority order).
// Falls back to a set+number-only search if the name+set search finds
// nothing (vendor names don't always match the API's card name).
//
// Returns an object describing the outcome:
//   { status: "matched", marketPrice: number, finish, card }
//   { status: "no-match" }               -> no card found for name/set/number
//   { status: "no-price" }                -> card found, but no price for any finish
//   { status: "error", message }          -> network/API failure
export async function fetchCardMarketPrice(cardName, setName, cardCode) {
  let { matches, error } = await searchCardsWithRetry(buildSearchUrl(cardName, setName));
  if (error) return error;

  const cardNumber = extractCardNumber(cardCode);
  if ((!matches || matches.length === 0) && cardNumber) {
    ({ matches, error } = await searchCardsWithRetry(buildNumberSearchUrl(setName, cardNumber)));
    if (error) return error;
  }

  if (!matches || matches.length === 0) {
    return { status: "no-match" };
  }

  const card = pickBestMatch(matches, cardCode);
  const { price: marketPrice, finish } = pickMarketPrice(card);

  if (marketPrice === undefined) {
    return { status: "no-price", card };
  }

  return { status: "matched", marketPrice, finish, card };
}
