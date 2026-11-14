"use strict";
/**
 * Pricing math for market seeding and agent fair values.
 *
 * The pm-AMM's own model (Paradigm, Moallemi & Robinson 2024) treats the
 * market's underlying score as a Gaussian random walk: the fair price of YES
 * for "S_T > K" is Phi( ln(S/K) / (sigma * sqrt(T)) ). We seed and trade with
 * exactly that formula, using the SDK's own capitalPhi for consistency with
 * the on-chain curve.
 */
const { capitalPhi } = require("@pm-amm/sdk/math");

/**
 * Fair YES probability that spot S finishes above strike K after T seconds,
 * given per-sqrt-second volatility sigma.
 */
function fairYesProb(S, K, sigmaPerSqrtSec, T) {
  if (T <= 0) return S > K ? 1 : 0;
  const vol = sigmaPerSqrtSec * Math.sqrt(T);
  if (!(vol > 0)) return S > K ? 1 : 0;
  const d = Math.log(S / K) / vol;
  return Math.min(0.999, Math.max(0.001, capitalPhi(d)));
}

/** Fair YES price in basis points [100, 9900] for createMarket seeding. */
function fairYesBps(S, K, sigmaPerSqrtSec, T) {
  const p = fairYesProb(S, K, sigmaPerSqrtSec, T);
  return Math.min(9900, Math.max(100, Math.round(p * 10000)));
}

/**
 * Estimate per-sqrt-second volatility from price samples [{ts, price}]
 * using log returns; falls back to `floorSigma` when data is thin.
 */
function estimateSigma(samples, floorSigma) {
  if (!samples || samples.length < 3) return floorSigma;
  const sorted = [...samples].sort((a, b) => a.ts - b.ts);
  const rets = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i].ts - sorted[i - 1].ts;
    if (dt > 0 && sorted[i].price > 0 && sorted[i - 1].price > 0) {
      rets.push({ r: Math.log(sorted[i].price / sorted[i - 1].price), dt });
    }
  }
  if (rets.length < 2) return floorSigma;
  const mean = rets.reduce((s, x) => s + x.r, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x.r - mean) ** 2, 0) / (rets.length - 1);
  // variance of a return over dt seconds ~ sigma^2 * mean_dt
  const meanDt = rets.reduce((s, x) => s + x.dt, 0) / rets.length;
  if (!(meanDt > 0)) return floorSigma;
  const sigma = Math.sqrt(Math.max(variance, 0) / meanDt);
  if (!Number.isFinite(sigma) || sigma <= 0) return floorSigma;
  // sanity clamp: never below the floor, never absurd
  return Math.min(Math.max(sigma, floorSigma), 2e-3);
}

/** Round a price to the asset's strike grid. */
function strikeFor(spot, step) {
  return Math.round(spot / step) * step;
}

module.exports = { fairYesProb, fairYesBps, estimateSigma, strikeFor };
