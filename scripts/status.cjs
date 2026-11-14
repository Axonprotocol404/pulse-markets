"use strict";
/** Print the PulseMarkets scoreboard: wallets, tracked markets, activity totals. */
const fs = require("fs");
const path = require("path");
const { PublicKey } = require("@solana/web3.js");
const config = require("../engine/config.cjs");
const { loadKeypair, makeClient, tokenBalance, solBalance } = require("../engine/chain.cjs");
const { marketState, fetchMarkets } = require("../engine/quotes.cjs");
const state = require("../engine/state.cjs");

(async () => {
  const st = state.load();
  const engineKp = loadKeypair(config.ENGINE_KEYPAIR_PATH);
  const { client, connection } = makeClient(engineKp);
  console.log(`engine ${engineKp.publicKey.toBase58()}  mUSDC=${(await tokenBalance(connection, engineKp.publicKey, config.MUSDC_MINT)).toFixed(2)}  SOL=${(await solBalance(connection, engineKp.publicKey)).toFixed(4)}`);
  const secretsDir = path.join(__dirname, "..", "..", "secrets");
  for (const f of fs.readdirSync(secretsDir).filter((x) => x.endsWith(".json")).sort()) {
    const kp = loadKeypair(path.join(secretsDir, f));
    console.log(`${f.replace(".json", "")} ${kp.publicKey.toBase58()}  mUSDC=${(await tokenBalance(connection, kp.publicKey, config.MUSDC_MINT)).toFixed(2)}  SOL=${(await solBalance(connection, kp.publicKey)).toFixed(4)}`);
  }
  if (st.markets.length) {
    const accounts = await fetchMarkets(client, st.markets.map((m) => new PublicKey(m.pda)));
    st.markets.forEach((m, i) => {
      const a = accounts[i];
      const ms = a ? marketState(a) : null;
      console.log(
        `${m.asset} strike=${m.strike} pda=${m.pda} endTs=${m.endTs} ` +
          (ms ? `price=${ms.price.toFixed(3)} left=${ms.secondsLeft}s resolved=${ms.resolved} winner=${ms.winner}` : "account missing")
      );
    });
  }
  const counts = {};
  let volume = 0;
  for (const ev of st.activity) {
    counts[ev.kind] = (counts[ev.kind] || 0) + 1;
    if (ev.kind === "swap") volume += ev.amountUsdc || 0;
  }
  console.log("activity:", JSON.stringify(counts), "| swap volume (mUSDC):", volume.toFixed(2));
})().catch((e) => {
  console.error("status ERR:", e.message);
  process.exit(1);
});
