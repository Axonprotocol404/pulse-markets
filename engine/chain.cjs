"use strict";
/**
 * Chain plumbing: wallet loading, an AnchorProvider whose confirmation is
 * HTTP-polled (this sandbox breaks websocket subscriptions to the devnet RPC,
 * which makes the stock provider.sendAndConfirm time out even when the
 * transaction lands), and small balance/faucet helpers.
 *
 * The pm-AMM SDK sends everything through provider.sendAndConfirm (see
 * PmAmmClient.sendIxs), so patching that one method makes every client.send.*
 * call reliable here.
 */
const fs = require("fs");
const {
  Connection,
  Keypair,
  Transaction,
} = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { PmAmmClient } = require("@pm-amm/sdk");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const config = require("./config.cjs");

function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll getSignatureStatuses until confirmed/finalized, error, or timeout. */
async function pollSignature(connection, signature, timeoutMs = 150000) {
  const started = Date.now();
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const st = value[0];
    if (st) {
      if (st.err) {
        const err = new Error(`transaction failed on-chain: ${JSON.stringify(st.err)} (sig ${signature})`);
        err.signature = signature;
        throw err;
      }
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
        return signature;
      }
    }
    if (Date.now() - started > timeoutMs) {
      const err = new Error(`transaction not confirmed within ${timeoutMs}ms (sig ${signature})`);
      err.signature = signature;
      err.timeout = true;
      throw err;
    }
    await sleep(2000);
  }
}

/**
 * sendAndConfirm replacement: builds blockhash, signs with the provider
 * wallet (+ extra signers), sends raw, and confirms by HTTP polling.
 * Retries with a fresh blockhash if the first attempt expires unconfirmed.
 */
function makePollingSendAndConfirm(connection, wallet) {
  return async function sendAndConfirm(tx, signers = [], _opts = {}) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const t = new Transaction();
      t.add(...tx.instructions);
      t.feePayer = wallet.publicKey;
      t.recentBlockhash = blockhash;
      t.lastValidBlockHeight = lastValidBlockHeight;
      const allSigners = [wallet.payer, ...signers.filter((s) => s && !s.publicKey.equals(wallet.publicKey))];
      t.sign(...allSigners);
      const raw = t.serialize();
      const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed" });
      try {
        return await pollSignature(connection, signature);
      } catch (e) {
        lastErr = e;
        if (!e.timeout) throw e; // on-chain failure: do not retry
        // timed out: the tx may still land; check once more before resending
        const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        if (value[0] && !value[0].err) return signature;
      }
    }
    throw lastErr;
  };
}

/** Build a PmAmmClient for a keypair, with polling-based confirmation. */
function makeClient(keypair) {
  const connection = new Connection(config.RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 150000,
  });
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  provider.sendAndConfirm = makePollingSendAndConfirm(connection, wallet);
  const client = PmAmmClient.fromProvider(provider, config.PROGRAM_ID, config.MUSDC_MINT);
  return { client, connection, provider, keypair };
}

/** Claim test funds (1,000 mUSDC + a devnet SOL drip) from the Predict faucet. */
async function claimFaucet(pubkey) {
  const res = await fetch(config.FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: pubkey.toBase58() }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, json, text };
}

async function tokenBalance(connection, owner, mint) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
  return bal ? Number(bal.value.amount) / 10 ** bal.value.decimals : 0;
}

async function solBalance(connection, owner) {
  return (await connection.getBalance(owner)) / 1e9;
}

module.exports = {
  loadKeypair,
  makeClient,
  pollSignature,
  claimFaucet,
  tokenBalance,
  solBalance,
  sleep,
};
