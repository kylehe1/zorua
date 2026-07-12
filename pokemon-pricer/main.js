// main.js
// Single responsibility: wire the DOM up to parser.js / fetcher.js / pricer.js.
// This is the only file that touches the page directly.

import { readInventoryFile, downloadResultsAsCsv } from "./parser.js";
import { fetchCardMarketPrice } from "./fetcher.js";
import { calculateAdjustedPrice } from "./pricer.js";

const fileInput = document.getElementById("file-input");
const statusMessage = document.getElementById("status-message");
const resultsTableBody = document.querySelector("#results-table tbody");
const downloadButton = document.getElementById("download-button");

// Small pause between API calls so we don't hammer the free API tier.
const REQUEST_DELAY_MS = 250;

// Holds the most recently computed results + spreadsheet metadata so the
// download button can rebuild the .xlsx on demand.
let lastResults = [];
let lastColumnMap = null;
let lastHeaderRow = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatus(message) {
  statusMessage.textContent = message;
}

// Renders one row into the results table for a given card, appending it
// to whatever rows are already there.
function appendResultRow(result) {
  const row = document.createElement("tr");
  row.classList.add(`status-${result.status}`);

  const oldPriceDisplay =
    typeof result.oldPrice === "number" ? `$${result.oldPrice.toFixed(2)}` : result.oldPrice || "—";
  const newPriceDisplay =
    result.newPrice !== null && result.newPrice !== undefined
      ? `$${result.newPrice.toFixed(2)}`
      : "—";

  row.innerHTML = `
    <td>${escapeHtml(result.cardName)}</td>
    <td>${escapeHtml(result.setName)}</td>
    <td>${escapeHtml(result.cardCode)}</td>
    <td>${escapeHtml(result.condition)}</td>
    <td>${escapeHtml(result.finish || "—")}</td>
    <td>${escapeHtml(String(oldPriceDisplay))}</td>
    <td>${escapeHtml(String(newPriceDisplay))}</td>
    <td>${escapeHtml(result.statusLabel)}</td>
  `;

  resultsTableBody.appendChild(row);
}

// Basic HTML escaping so vendor spreadsheet data (card names, etc.) can't
// break the table markup if it happens to contain "<" or "&".
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// Maps a fetch outcome to a human-readable status label shown in the table.
function describeStatus(status) {
  switch (status) {
    case "matched":
      return "Matched";
    case "no-match":
      return "No card match found";
    case "no-price":
      return "Matched, no price for finish";
    case "error":
      return "API error";
    default:
      return "Unknown";
  }
}

// Processes one inventory row: fetch the market price, apply the condition
// multiplier, and return a result object ready for display/export.
async function processRow(row) {
  const fetchResult = await fetchCardMarketPrice(row.cardName, row.setName, row.cardCode);

  const marketPrice = fetchResult.status === "matched" ? fetchResult.marketPrice : null;
  const newPrice = calculateAdjustedPrice(marketPrice, row.condition);

  return {
    cardName: row.cardName,
    setName: row.setName,
    cardCode: row.cardCode,
    condition: row.condition,
    finish: fetchResult.finish,
    oldPrice: row.price,
    newPrice,
    status: fetchResult.status,
    statusLabel:
      fetchResult.status === "error" ? fetchResult.message : describeStatus(fetchResult.status),
    _original: row._original,
  };
}

// Runs through every row sequentially (not in parallel) so we stay well
// under the API's rate limit, updating the table as each result arrives.
async function processInventory(rows) {
  const results = [];

  for (let i = 0; i < rows.length; i++) {
    setStatus(`Fetching prices... (${i + 1}/${rows.length})`);

    const result = await processRow(rows[i]);
    results.push(result);
    appendResultRow(result);

    if (i < rows.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return results;
}

async function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Reset UI for a fresh run.
  resultsTableBody.innerHTML = "";
  downloadButton.disabled = true;
  lastResults = [];

  try {
    setStatus("Reading spreadsheet...");
    const { rows, columnMap, headerRow } = await readInventoryFile(file);

    if (rows.length === 0) {
      setStatus("No data rows found in spreadsheet.");
      return;
    }

    lastColumnMap = columnMap;
    lastHeaderRow = headerRow;

    lastResults = await processInventory(rows);

    setStatus(`Done. Processed ${lastResults.length} card(s).`);
    downloadButton.disabled = false;
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

function handleDownloadClick() {
  if (lastResults.length === 0) return;
  downloadResultsAsCsv(lastResults, lastColumnMap, lastHeaderRow, "updated-prices.csv");
}

fileInput.addEventListener("change", handleFileSelected);
downloadButton.addEventListener("click", handleDownloadClick);
