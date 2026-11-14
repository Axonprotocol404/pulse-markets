"use strict";
/**
 * Price feed adapter.
 *
 * Settlement and seeding need ONE objective number per asset. We take the
 * median of two independent public exchange feeds (Kraken + Coinbase), both
 * keyless. A Pyth Hermes source is implemented too (feed ids in config.cjs);
 * Hermes' public endpoint currently returns 401 from this network, so it is
 * used opportunistically and never required.
 */

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "pulsemarkets/0.1" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function krakenPrice(pair) {
  const j = await fetchJson(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  if (j.error && j.error.length) throw new Error(`kraken: ${j.error.join(",")}`);
  const key = Object.keys(j.result)[0];
  return Number(j.result[key].c[0]); // last trade price
}

async function coinbasePrice(product) {
  const j = await fetchJson(`https://api.exchange.coinbase.com/products/${product}/ticker`);
  return Number(j.price);
}

/**
 * Median spot price for an asset config entry.
 * Returns { price, sources: [{name, price}...], ts } — needs >= 1 source,
 * prefers 2; throws if none respond.
 */
async function getSpot(asset) {
  const attempts = [
    ["kraken", () => krakenPrice(asset.krakenPair)],
    ["coinbase", () => coinbasePrice(asset.coinbaseProduct)],
  ];
  const ok = [];
  const errs = [];
  for (const [name, fn] of attempts) {
    try {
      const price = await fn();
      if (Number.isFinite(price) && price > 0) ok.push({ name, price });
    } catch (e) {
      errs.push(`${name}: ${e.message}`);
    }
  }
  if (!ok.length) throw new Error(`no price source for ${asset.symbol} (${errs.join("; ")})`);
  const sorted = ok.map((s) => s.price).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const price = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { price, sources: ok, ts: Math.floor(Date.now() / 1000) };
}

module.exports = { getSpot, krakenPrice, coinbasePrice };
