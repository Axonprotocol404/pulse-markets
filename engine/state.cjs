"use strict";
/** Tiny JSON state store: tracked markets, price samples, activity log. */
const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "..", "state");
const STATE_FILE = path.join(STATE_DIR, "state.json");

function emptyState() {
  return { markets: [], samples: {}, activity: [] };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return emptyState();
  }
}

function save(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

/** Append an activity event (kept bounded) and persist. */
function record(state, kind, detail) {
  state.activity.push({ ts: Math.floor(Date.now() / 1000), kind, ...detail });
  if (state.activity.length > 2000) state.activity = state.activity.slice(-2000);
  save(state);
}

/** Remember a price sample for vol estimation (bounded per asset). */
function addSample(state, symbol, price, ts) {
  state.samples[symbol] = state.samples[symbol] || [];
  state.samples[symbol].push({ ts, price });
  state.samples[symbol] = state.samples[symbol].slice(-240);
}

module.exports = { load, save, record, addSample, STATE_FILE };
