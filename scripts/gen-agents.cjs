"use strict";
/**
 * Generate the trading-agent keypairs (forecaster, market-maker) into
 * ../secrets/ — OUTSIDE this repo. Devnet-only wallets holding test funds.
 * Idempotent: existing files are never overwritten.
 */
const fs = require("fs");
const path = require("path");
const { Keypair } = require("@solana/web3.js");

const SECRETS_DIR = path.join(__dirname, "..", "..", "secrets");
const AGENTS = ["forecaster", "marketmaker"];

fs.mkdirSync(SECRETS_DIR, { recursive: true });
for (const name of AGENTS) {
  const file = path.join(SECRETS_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
    console.log(`${name}: exists -> ${kp.publicKey.toBase58()}`);
    continue;
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`${name}: generated -> ${kp.publicKey.toBase58()}`);
}
