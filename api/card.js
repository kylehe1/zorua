// api/card.js
// Vercel serverless function. Proxies card lookups to api.pokemontcg.io so
// the real API key stays server-side (read from the POKEMONTCG_API_KEY
// environment variable) and is never shipped to the browser.

const API_BASE_URL = "https://api.pokemontcg.io/v2/cards";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { name, set, number } = request.query;

  if (!name || !set) {
    response.status(400).json({ error: "Missing required query params: name, set" });
    return;
  }

  const queryParts = [`name:"${name}"`, `set.name:"${set}"`];
  if (number) {
    queryParts.push(`number:"${number}"`);
  }

  const url = `${API_BASE_URL}?${new URLSearchParams({ q: queryParts.join(" ") }).toString()}`;

  const apiKey = process.env.POKEMONTCG_API_KEY;

  let apiResponse;
  try {
    apiResponse = await fetch(url, {
      headers: apiKey ? { "X-Api-Key": apiKey } : {},
    });
  } catch (networkError) {
    response.status(502).json({ error: `Network error: ${networkError.message}` });
    return;
  }

  if (!apiResponse.ok) {
    response.status(apiResponse.status).json({ error: `API returned ${apiResponse.status}` });
    return;
  }

  const body = await apiResponse.json();
  response.status(200).json(body);
}
