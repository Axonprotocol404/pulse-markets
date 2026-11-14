"use strict";
/** Lifecycle proof on the throwaway probe market: wait for expiry if needed,
 *  resolve with the authority wallet, then claim LP residuals. */
const path = require("path");
const { loadKeypair, makeClient, sleep } = require("../engine/chain.cjs");
(async () => {
  const kp = loadKeypair(path.join(__dirname, "..", "..", "probe", "devnet-wallet.json"));
  const { client } = makeClient(kp);
  const all = await client.fetchAllMarkets();
  const now = Math.floor(Date.now() / 1000);
  const mine = all.filter((e) => e.account.authority.equals(kp.publicKey) && !e.account.resolved);
  console.log("unresolved probe markets:", mine.length, "| now:", now);
  for (const e of mine) {
    const pda = e.publicKey;
    const endTs = e.account.endTs.toNumber();
    const waitS = endTs - Math.floor(Date.now() / 1000);
    if (waitS > 0) {
      console.log(`${pda.toBase58()}: expires in ${waitS}s, waiting…`);
      await sleep((waitS + 8) * 1000);
    }
    const sig = await client.send.resolveMarket(pda, "yes");
    console.log("resolve sig:", sig);
    const after = await client.fetchMarket(pda);
    console.log("resolved:", after.resolved, "| winningSide:", after.winningSide);
    try {
      const csig = await client.send.claimLpResiduals(pda);
      console.log("claimLpResiduals sig:", csig);
    } catch (err) {
      console.log("claimLpResiduals note:", String(err.message).slice(0, 220));
    }
  }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
