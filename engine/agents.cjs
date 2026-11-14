"use strict";
/**
 * The PulseMarkets agent swarm: two autonomous traders on the engine's markets.
 *
 * - Forecaster: prices each market with the Gaussian model (live spot, strike,
 *   realised vol, time left). Buys the side the AMM prices below its fair
 *   value when the edge exceeds 5%, sized by edge.
 * - Market maker: trades the cheap side on a thinner 2% threshold with small
 *   clips, and recycles capital by redeeming YES+NO pairs 1:1 for mUSDC.
 *
 * Both also sweep claimWinnings on resolved markets. Every action is a real
 * devnet transaction and is written to the activity log (state/activity).
 *
 * Usage: node engine/agents.cjs [--rounds 1] [--sleep 20]
 */
const fs = require("fs");
const path = require("path");
const { PublicKey } = require("@solana/web3.js");
const config = require("./config.cjs");
const { loadKeypair, makeClient, tokenBalance, sleep } = require("./chain.cjs");
const { getSpot } = require("./feed.cjs");
const { fairYesProb, estimateSigma } = require("./mathx.cjs");
const { marketState, quoteSwap, minOutput, fetchMarkets } = require("./quotes.cjs");
const state = require("./state.cjs");

const SECRETS_DIR = path.join(__dirname, "..", "..", "secrets");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

async function trySwap(st, agentName, ctx, marketAcct, pda, direction, humanAmount) {
  const raw = Math.round(humanAmount * 1e6);
  const quote = quoteSwap(marketAcct, direction, raw);
  const sig = await ctx.client.send.swap(new PublicKey(pda), direction, raw, minOutput(quote, 200));
  state.record(st, "swap", {
    agent: agentName,
    pda,
    direction,
    amountUsdc: humanAmount,
    expectedOut: quote.out / 1e6,
    sig,
  });
  console.log(`${agentName}: swap ${direction} ${humanAmount} mUSDC on ${pda.slice(0, 8)}… sig=${sig.slice(0, 12)}…`);
  return sig;
}

async function claimSweep(st, agentName, ctx, resolvedMarkets) {
  for (const m of resolvedMarkets) {
    try {
      const pda = new PublicKey(m.pda);
      const winMint = m.winner === "yes" ? ctx.client.yesMint(pda) : ctx.client.noMint(pda);
      const bal = await tokenBalance(ctx.connection, ctx.keypair.publicKey, winMint);
      if (bal > 0) {
        const sig = await ctx.client.send.claimWinnings(pda);
        state.record(st, "claim", { agent: agentName, pda: m.pda, amount: bal, sig });
        console.log(`${agentName}: claimed ${bal} winning tokens on ${m.pda.slice(0, 8)}… sig=${sig.slice(0, 12)}…`);
      }
    } catch (e) {
      console.error(`${agentName}: claim on ${m.pda.slice(0, 8)}… failed: ${e.message}`);
    }
  }
}

(async () => {
  const rounds = arg("rounds", 1);
  const sleepSecs = arg("sleep", 20);
  const st = state.load();

  const agents = {};
  for (const name of ["forecaster", "marketmaker"]) {
    const kp = loadKeypair(path.join(SECRETS_DIR, `${name}.json`));
    agents[name] = { name, kp, ...makeClient(kp) };
  }
  const reader = agents.forecaster; // any client can read

  for (let round = 0; round < rounds; round++) {
    const now = Math.floor(Date.now() / 1000);
    const live = st.markets.filter((m) => !m.resolved && m.endTs > now + 90);
    const resolved = st.markets.filter((m) => m.resolved);
    console.log(`--- round ${round + 1}/${rounds}: ${live.length} live markets, ${resolved.length} resolved ---`);

    // one spot read per asset per round
    const spots = {};
    for (const asset of config.ASSETS) {
      try {
        const s = await getSpot(asset);
        spots[asset.symbol] = s;
        state.addSample(st, asset.symbol, s.price, s.ts);
      } catch (e) {
        console.error(`spot ${asset.symbol} failed: ${e.message}`);
      }
    }

    if (live.length) {
      const accounts = await fetchMarkets(reader.client, live.map((m) => new PublicKey(m.pda)));
      for (let i = 0; i < live.length; i++) {
        const entry = live[i];
        const acct = accounts[i];
        if (!acct) continue;
        const asset = config.ASSETS.find((a) => a.symbol === entry.asset);
        const spot = spots[entry.asset];
        if (!spot) continue;
        const ms = marketState(acct);
        if (ms.resolved || ms.expired) continue;
        const sigma = estimateSigma(st.samples[entry.asset], asset.sigmaFloor);
        const fair = fairYesProb(spot.price, entry.strike, sigma, ms.secondsLeft);
        const edge = fair - ms.price;

        // --- forecaster: 5% threshold, edge-sized clips
        try {
          if (edge > 0.05) {
            await trySwap(st, "forecaster", agents.forecaster, acct, entry.pda, "usdcToYes", clamp(Math.abs(edge) * 300, 5, 25));
          } else if (edge < -0.05) {
            await trySwap(st, "forecaster", agents.forecaster, acct, entry.pda, "usdcToNo", clamp(Math.abs(edge) * 300, 5, 25));
          }
        } catch (e) {
          console.error(`forecaster on ${entry.pda.slice(0, 8)}…: ${e.message}`);
        }

        // --- market maker: 2% threshold, small clips + pair redemption
        try {
          if (edge > 0.02) {
            await trySwap(st, "marketmaker", agents.marketmaker, acct, entry.pda, "usdcToYes", 4);
          } else if (edge < -0.02) {
            await trySwap(st, "marketmaker", agents.marketmaker, acct, entry.pda, "usdcToNo", 4);
          }
          const pda = new PublicKey(entry.pda);
          const [yesBal, noBal] = await Promise.all([
            tokenBalance(agents.marketmaker.connection, agents.marketmaker.kp.publicKey, agents.marketmaker.client.yesMint(pda)),
            tokenBalance(agents.marketmaker.connection, agents.marketmaker.kp.publicKey, agents.marketmaker.client.noMint(pda)),
          ]);
          const pair = Math.min(yesBal, noBal);
          if (pair >= 5) {
            const sig = await agents.marketmaker.client.send.redeemPair(pda, Math.floor(pair * 1e6));
            state.record(st, "redeem_pair", { agent: "marketmaker", pda: entry.pda, amount: pair, sig });
            console.log(`marketmaker: redeemed ${pair} pairs on ${entry.pda.slice(0, 8)}… sig=${sig.slice(0, 12)}…`);
          }
        } catch (e) {
          console.error(`marketmaker on ${entry.pda.slice(0, 8)}…: ${e.message}`);
        }
      }
    }

    for (const name of Object.keys(agents)) {
      await claimSweep(st, name, agents[name], resolved);
    }
    state.save(st);
    if (round < rounds - 1) await sleep(sleepSecs * 1000);
  }
})().catch((e) => {
  console.error("agents ERR:", e.message);
  process.exit(1);
});
