"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fairYesProb, fairYesBps, estimateSigma, strikeFor } = require("../engine/mathx.cjs");

const SIGMA = 1.4e-4; // per sqrt(second), SOL-like

test("fairYesProb at the money is 0.5", () => {
  const p = fairYesProb(100, 100, SIGMA, 3600);
  assert.ok(Math.abs(p - 0.5) < 1e-9, `got ${p}`);
});

test("fairYesProb increases with spot and decreases with strike", () => {
  const base = fairYesProb(100, 100, SIGMA, 3600);
  assert.ok(fairYesProb(101, 100, SIGMA, 3600) > base);
  assert.ok(fairYesProb(100, 101, SIGMA, 3600) < base);
});

test("fairYesProb at expiry is a step function", () => {
  assert.equal(fairYesProb(101, 100, SIGMA, 0), 1);
  assert.equal(fairYesProb(99, 100, SIGMA, 0), 0);
});

test("fairYesProb one sigma above strike ~ 0.84", () => {
  // ln(S/K) = sigma*sqrt(T)  =>  d = 1  =>  Phi(1) = 0.8413
  const T = 3600;
  const S = 100 * Math.exp(SIGMA * Math.sqrt(T));
  const p = fairYesProb(S, 100, SIGMA, T);
  assert.ok(Math.abs(p - 0.8413) < 0.005, `got ${p}`);
});

test("fairYesBps clamps to [100, 9900]", () => {
  assert.equal(fairYesBps(10000, 1, SIGMA, 3600), 9900);
  assert.equal(fairYesBps(1, 10000, SIGMA, 3600), 100);
  assert.equal(fairYesBps(100, 100, SIGMA, 3600), 5000);
});

test("estimateSigma falls back to floor with thin data", () => {
  assert.equal(estimateSigma([], 1.2e-4), 1.2e-4);
  assert.equal(estimateSigma([{ ts: 1, price: 100 }], 1.2e-4), 1.2e-4);
});

test("estimateSigma recovers a plausible vol from a random walk", () => {
  // deterministic pseudo-random walk with known per-second sigma ~ 2e-4
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const samples = [];
  let price = 100;
  const trueSigma = 2e-4;
  for (let t = 0; t <= 600; t += 10) {
    const shock = (rnd() + rnd() + rnd() - 1.5) * 2 * trueSigma * Math.sqrt(10);
    price *= Math.exp(shock);
    samples.push({ ts: 1000000 + t, price });
  }
  const est = estimateSigma(samples, 1e-4);
  assert.ok(est > 0.8e-4 && est < 8e-4, `estimated ${est}`);
});

test("strikeFor rounds to the grid", () => {
  assert.equal(strikeFor(72.68, 1), 73);
  assert.equal(strikeFor(72.4, 1), 72);
  assert.equal(strikeFor(90123, 100), 90100);
});
