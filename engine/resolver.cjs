"use strict";
/**
 * Resolver keeper: settles expired PulseMarkets from the public price feeds.
 *
 * Predict's pm-AMM has manual resolution (the market creator is the
 * authority) and no oracle. This keeper is the oracle adapter: once a market
 * expires it reads the median spot from two independent public feeds and
 * resolves YES iff settlement price >= strike. Every settlement is logged
 * with the price and sources used.
 *
 * Usage: node engine/resolver.cjs
 */
const { PublicKey } = require("@solana/web3.js");
const config = require("./config.cjs");
const { loadKeypair, makeClient } = require("./chain.cjs");
const { getSpot } = require("./feed.cjs");
const { fetchMarkets } = require("./quotes.cjs");
const state = require("./state.cjs");

(async () => {
  const kp = loadKeypair(config.ENGINE_KEYPAIR_PATH);
  const { client } = makeClient(kp);
  const st = state.load();
  const now = Math.floor(Date.now() / 1000);
  const due = st.markets.filter((m) => !m.resolved && m.endTs <= now);
  if (!due.length) {
    console.log("resolver: no markets due");
    return;
  }
  const accounts = await fetchMarkets(client, due.map((m) => new PublicKey(m.pda)));
  for (let i = 0; i < due.length; i++) {
    const entry = due[i];
    const acct = accounts[i];
    try {
      if (!acct) {
        console.log(`${entry.asset} ${entry.pda}: account not found, skipping`);
        continue;
      }
      if (acct.resolved) {
        entry.resolved = true;
        entry.winner = acct.winningSide === 1 ? "yes" : "no";
        state.record(st, "market_resolved_sync", { pda: entry.pda, winner: entry.winner });
        console.log(`${entry.asset} ${entry.pda}: already resolved on-chain (${entry.winner})`);
        continue;
      }
      const asset = config.ASSETS.find((a) => a.symbol === entry.asset);
      const spot = await getSpot(asset);
      const side = spot.price >= entry.strike ? "yes" : "no";
      const sig = await client.send.resolveMarket(new PublicKey(entry.pda), side);
      entry.resolved = true;
      entry.winner = side;
      entry.settlePrice = spot.price;
      entry.settleSources = spot.sources;
      entry.settleSig = sig;
      state.record(st, "market_resolved", {
        asset: entry.asset,
        pda: entry.pda,
        strike: entry.strike,
        settlePrice: spot.price,
        winner: side,
        sig,
      });
      console.log(`${entry.asset} ${entry.pda}: strike=${entry.strike} settle=${spot.price} -> ${side.toUpperCase()} sig=${sig}`);
    } catch (e) {
      console.error(`${entry.asset} ${entry.pda}: resolve FAILED ${e.message}`);
      state.record(st, "resolve_failed", { pda: entry.pda, error: String(e.message).slice(0, 300) });
    }
  }
  state.save(st);
})().catch((e) => {
  console.error("resolver ERR:", e.message);
  process.exit(1);
});
