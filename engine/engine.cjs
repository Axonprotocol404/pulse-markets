"use strict";
/**
 * Market factory: creates the next hourly PulseMarkets on Predict's pm-AMM.
 *
 * For each tracked asset: read the spot price from the public feeds, snap a
 * strike to the asset's grid, seed the market at the Gaussian fair value
 * (the pm-AMM model's own pricing assumption), and deposit starter liquidity.
 * One market per asset per window; safe to run repeatedly (cron-friendly).
 *
 * Usage: node engine/engine.cjs [--duration 3600] [--deposit 100]
 */
const config = require("./config.cjs");
const { loadKeypair, makeClient } = require("./chain.cjs");
const { getSpot } = require("./feed.cjs");
const { fairYesBps, estimateSigma, strikeFor } = require("./mathx.cjs");
const state = require("./state.cjs");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

function fmtTimeUTC(ts) {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

(async () => {
  const duration = arg("duration", config.MARKET_DURATION_SECS);
  const deposit = arg("deposit", config.MARKET_DEPOSIT_USDC);
  const kp = loadKeypair(config.ENGINE_KEYPAIR_PATH);
  const { client, connection } = makeClient(kp);
  const st = state.load();
  const now = Math.floor(Date.now() / 1000);

  for (const asset of config.ASSETS) {
    try {
      const live = st.markets.find(
        (m) => m.asset === asset.symbol && !m.resolved && m.endTs > now + 900
      );
      const spot = await getSpot(asset);
      state.addSample(st, asset.symbol, spot.price, spot.ts);
      if (live) {
        console.log(`${asset.symbol}: live market exists (${live.pda}) until ${fmtTimeUTC(live.endTs)} UTC, spot=${spot.price}`);
        state.save(st);
        continue;
      }
      const sigma = estimateSigma(st.samples[asset.symbol], asset.sigmaFloor);
      const strike = strikeFor(spot.price, asset.strikeStep);
      const seedBps = fairYesBps(spot.price, strike, sigma, duration);
      const endTs = now + duration;
      const name = `Will ${asset.symbol} close above $${strike} at ${fmtTimeUTC(endTs)} UTC?`;
      console.log(`${asset.symbol}: spot=${spot.price} strike=${strike} seed=${seedBps}bps sigma=${sigma.toExponential(2)} name="${name}"`);
      const res = await client.send.createMarket({
        name,
        durationSecs: duration,
        initialPriceBps: seedBps,
        depositUsdc: deposit,
      });
      const entry = {
        pda: res.marketPda,
        marketId: res.marketId,
        asset: asset.symbol,
        strike,
        seedBps,
        spotAtCreate: spot.price,
        createdTs: now,
        endTs,
        durationSecs: duration,
        depositUsdc: deposit,
        createSig: res.signature,
        resolved: false,
        winner: null,
      };
      st.markets.push(entry);
      state.record(st, "market_created", {
        asset: asset.symbol,
        pda: res.marketPda,
        strike,
        seedBps,
        sig: res.signature,
      });
      console.log(`${asset.symbol}: market created ${res.marketPda} sig=${res.signature}`);
    } catch (e) {
      console.error(`${asset.symbol}: FAILED ${e.message}`);
      state.record(st, "market_create_failed", { asset: asset.symbol, error: String(e.message).slice(0, 300) });
    }
  }
  state.save(st);
})().catch((e) => {
  console.error("engine ERR:", e.message);
  process.exit(1);
});
