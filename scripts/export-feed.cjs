"use strict";
/**
 * Export the engine state as web/public/feed.json for the web app:
 * tracked markets, the agent activity log, and traction totals.
 * Run before building/deploying the web app (and any time to refresh it).
 */
const fs = require("fs");
const path = require("path");
const state = require("../engine/state.cjs");

const st = state.load();
let swaps = 0;
let volume = 0;
let claims = 0;
for (const ev of st.activity) {
  if (ev.kind === "swap") {
    swaps++;
    volume += ev.amountUsdc || 0;
  }
  if (ev.kind === "claim") claims++;
}
const feed = {
  generatedAt: Math.floor(Date.now() / 1000),
  engineWallet: "9vBCGRVRbhjDN4MABdDj5VqJGfb8PoTJFvRXe6P5HySt",
  markets: st.markets.map((m) => ({
    pda: m.pda,
    asset: m.asset,
    strike: m.strike,
    seedBps: m.seedBps,
    createdTs: m.createdTs,
    endTs: m.endTs,
    winner: m.winner,
    settlePrice: m.settlePrice || null,
  })),
  activity: [...st.activity].slice(-60).reverse(),
  totals: {
    marketsCreated: st.markets.length,
    agentSwaps: swaps,
    agentVolumeUsdc: Number(volume.toFixed(2)),
    claims,
  },
};
const out = path.join(__dirname, "..", "web", "public", "feed.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(feed, null, 2));
console.log(`wrote ${out}: ${feed.markets.length} markets, ${feed.activity.length} events`);
