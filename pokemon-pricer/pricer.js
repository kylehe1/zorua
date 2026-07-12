// pricer.js
// Single responsibility: apply condition-based price adjustments.
// This module has no knowledge of the DOM, the API, or spreadsheets —
// it just does math on prices.

// Multiplier applied to the Near Mint (NM) market price to estimate
// the value of a card in a lesser condition.
export const CONDITION_MULTIPLIERS = {
  NM: 1.0, // Near Mint
  LP: 0.8, // Lightly Played
  MP: 0.6, // Moderately Played
  HP: 0.4, // Heavily Played
};

// Returns the multiplier for a given condition code, defaulting to NM (1.0)
// if the condition is missing or not recognized. We default rather than
// throw so a single bad/blank cell doesn't stop the whole batch — the row
// is still flagged separately (as a warning) by the caller.
export function getConditionMultiplier(condition) {
  const normalized = (condition || "").trim().toUpperCase();
  return CONDITION_MULTIPLIERS[normalized] ?? 1.0;
}

// Given the NM market price fetched from the API and a condition code,
// calculate the adjusted price. Returns null if marketPrice is missing
// (e.g. the API had no price data for that finish) so callers can display
// "no data" instead of a misleading $0.00.
export function calculateAdjustedPrice(marketPrice, condition) {
  if (marketPrice === null || marketPrice === undefined || isNaN(marketPrice)) {
    return null;
  }

  const multiplier = getConditionMultiplier(condition);
  const adjusted = marketPrice * multiplier;

  // Round to 2 decimal places like a real price tag.
  return Math.round(adjusted * 100) / 100;
}
