"use strict";
/**
 * Claim Predict-faucet funds (1,000 mUSDC + devnet SOL drip, 1 claim/wallet/hour)
 * for the engine wallet and every agent wallet in ../secrets/, then print balances.
 */
const fs = require("fs");
const path = require("path");
const { Keypair } = require("@solana/web3.js");
const { Connection } = require("@solana/web3.js");
const config = require("../engine/config.cjs");
const { claimFaucet, tokenBalance, solBalance } = require("../engine/chain.cjs");

async function report(conn, label, kp) {
  const [musdc, sol] = await Promise.all([
    tokenBalance(conn, kp.publicKey, config.MUSDC_MINT),
    solBalance(conn, kp.publicKey),
  ]);
  console.log(`${label} ${kp.publicKey.toBase58()}  mUSDC=${musdc.toFixed(2)}  SOL=${sol.toFixed(4)}`);
  return { musdc, sol };
}

(async () => {
  const conn = new Connection(config.RPC_URL, "confirmed");
  const wallets = [];
  const engineKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(config.ENGINE_KEYPAIR_PATH, "utf8")))
  );
  wallets.push(["engine", engineKp]);
  const secretsDir = path.join(__dirname, "..", "..", "secrets");
  for (const f of fs.readdirSync(secretsDir).filter((x) => x.endsWith(".json")).sort()) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(secretsDir, f), "utf8"))));
    wallets.push([f.replace(".json", ""), kp]);
  }
  for (const [label, kp] of wallets) {
    const before = await report(conn, `${label} (before)`, kp);
    // Threshold SOL dinaikkan 0,05 -> 0,15 (15 Nov 2026): satu batch 3 market
    // butuh ~0,106 SOL rent, ambang lama terbukti membuat create market
    // gagal di tengah batch (run 05:35 WIB). Klaim faucet 1x/wallet/jam.
    if (before.musdc < 200 || before.sol < 0.15) {
      const r = await claimFaucet(kp.publicKey);
      console.log(`${label}: faucet claim -> HTTP ${r.status} ${r.text.slice(0, 160)}`);
    } else {
      console.log(`${label}: sufficiently funded, no claim`);
    }
    await report(conn, `${label} (after) `, kp);
  }
})().catch((e) => {
  console.error("fund ERR:", e.message);
  process.exit(1);
});
