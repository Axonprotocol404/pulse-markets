"use strict";
/**
 * Price feed adapter.
 *
 * Seeding uses the live median spot; settlement uses the close of the
 * 1-minute candle at the market's expiry minute — so a market can be
 * resolved correctly at any time after expiry, reproducibly, from public
 * exchange history. Sources: Kraken + Coinbase (keyless), Binance klines as
 * a third fallback. A Pyth Hermes source exists in config (feed ids); its
 * public endpoint currently returns 401 from this network, so it is never
 * required.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonOnce(url, timeoutMs) {
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

/** fetch with retries — public exchange APIs + sandbox egress are flaky. */
async function fetchJson(url, timeoutMs = 30000, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJsonOnce(url, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
 * Median live spot price for an asset config entry.
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
  return { price: median(ok.map((s) => s.price)), sources: ok, ts: Math.floor(Date.now() / 1000) };
}

/** Close of the 1-minute candle starting at `minuteStart` (unix seconds). */
async function krakenCandleClose(pair, minuteStart) {
  const j = await fetchJson(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1&since=${minuteStart - 120}`,
  );
  if (j.error && j.error.length) throw new Error(`kraken: ${j.error.join(",")}`);
  const key = Object.keys(j.result).find((k) => k !== "last");
  const rows = j.result[key] || [];
  const row = rows.find((r) => r[0] === minuteStart) || rows[rows.length - 1];
  if (!row) throw new Error("kraken: no candle");
  return Number(row[4]); // close
}

async function coinbaseCandleClose(product, minuteStart) {
  const start = new Date((minuteStart - 60) * 1000).toISOString();
  const end = new Date((minuteStart + 120) * 1000).toISOString();
  const j = await fetchJson(
    `https://api.exchange.coinbase.com/products/${product}/candles?granularity=60&start=${start}&end=${end}`,
  );
  if (!Array.isArray(j)) throw new Error(`coinbase: ${j.message || "bad response"}`);
  const row = j.find((r) => r[0] === minuteStart);
  if (!row) throw new Error("coinbase: no candle");
  return Number(row[4]); // close
}

async function binanceCandleClose(symbol, minuteStart) {
  const j = await fetchJson(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${minuteStart * 1000}&limit=1`,
  );
  if (!Array.isArray(j) || !j.length) throw new Error("binance: no candle");
  return Number(j[0][4]); // close (USDT-quoted; fallback source only)
}

/**
 * Settlement price for `ts`: median close of the 1-minute candle that starts
 * at floor(ts/60)*60, across the sources that answer. Reproducible from
 * public data at any time after the candle closes.
 */
async function getSpotAt(asset, ts) {
  const minuteStart = Math.floor(ts / 60) * 60;
  const attempts = [
    ["kraken", () => krakenCandleClose(asset.krakenPair, minuteStart)],
    ["coinbase", () => coinbaseCandleClose(asset.coinbaseProduct, minuteStart)],
    ["binance", () => binanceCandleClose(asset.binanceSymbol, minuteStart)],
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
  if (!ok.length) throw new Error(`no settlement price for ${asset.symbol}@${minuteStart} (${errs.join("; ")})`);
  return { price: median(ok.map((s) => s.price)), sources: ok, ts: minuteStart };
}

module.exports = { getSpot, getSpotAt, krakenPrice, coinbasePrice };
