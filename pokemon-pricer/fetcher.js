// fetcher.js
// Single responsibility: talk to our backend proxy (/api/card), which in
// turn talks to the Pokémon TCG API (pokemontcg.io v2). The real API key
// lives server-side only (see api/card.js) and never reaches the browser.
// No DOM access and no pricing math here — just fetch + shape the response.

const API_BASE_URL = "/api/card";

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

// Builds the search query URL for a given card name and set name.
// Both values are quoted so the API matches them as exact phrases.
function buildSearchUrl(cardName, setName) {
  const query = `name:"${cardName}" set.name:"${setName}"`;
  const params = new URLSearchParams({ q: query });
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

// Fetches the best-matching card for a given name/set/card code and
// returns its TCGplayer market price (trying finishes in priority order).
//
// Returns an object describing the outcome:
//   { status: "matched", marketPrice: number, finish, card }
//   { status: "no-match" }               -> no card found for name/set
//   { status: "no-price" }                -> card found, but no price for any finish
//   { status: "error", message }          -> network/API failure
export async function fetchCardMarketPrice(cardName, setName, cardCode) {
  const url = buildSearchUrl(cardName, setName);

  let response;
  try {
    response = await fetch(url);
  } catch (networkError) {
    return { status: "error", message: `Network error: ${networkError.message}` };
  }

  if (!response.ok) {
    return { status: "error", message: `API returned ${response.status}` };
  }

  const body = await response.json();
  const matches = body.data;

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
