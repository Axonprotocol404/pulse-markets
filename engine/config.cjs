"use strict";
/** PulseMarkets — shared configuration (Solana devnet only). */
const { PublicKey } = require("@solana/web3.js");

const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const MUSDC_MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const RPC_URL = process.env.PULSE_RPC || "https://api.devnet.solana.com";
const FAUCET_URL = "https://pm-amm-devnet.vercel.app/api/faucet";

/** Engine / market-authority wallet (the registered participant's agent wallet). */
const ENGINE_KEYPAIR_PATH =
  process.env.PULSE_ENGINE_KEYPAIR ||
  "/home/hatch/workspace/bounty/makefun-agent/makefun-keypair.json";

/** Minutes of trading window per market. Program rejects 300s; 3600s verified working. */
const MARKET_DURATION_SECS = Number(process.env.PULSE_DURATION_SECS || 3600);
/** Initial liquidity deposited by the engine per market, in mUSDC (human units). */
const MARKET_DEPOSIT_USDC = Number(process.env.PULSE_DEPOSIT_USDC || 100);

/**
 * Assets the engine makes markets on. `feedId` = Pyth Hermes feed id (verified
 * against hermes.pyth.network on 2026-11-14; Hermes' public endpoint currently
 * answers 401, so live prices come from the public Kraken/Coinbase feeds and the
 * Pyth id is kept for the on-chain Pyth adapter path).
 * `sigmaFloor` = per-sqrt(second) volatility floor used until enough local
 * samples exist to estimate realised vol.
 */
const ASSETS = [
  {
    symbol: "SOL",
    krakenPair: "SOLUSD",
    coinbaseProduct: "SOL-USD",
    binanceSymbol: "SOLUSDT",
    feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    strikeStep: 1,
    strikeDecimals: 0,
    sigmaFloor: 1.4e-4,
  },
  {
    symbol: "BTC",
    krakenPair: "XBTUSD",
    coinbaseProduct: "BTC-USD",
    binanceSymbol: "BTCUSDT",
    feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    strikeStep: 100,
    strikeDecimals: 0,
    sigmaFloor: 1.1e-4,
  },
  {
    symbol: "ETH",
    krakenPair: "ETHUSD",
    coinbaseProduct: "ETH-USD",
    binanceSymbol: "ETHUSDT",
    feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    strikeStep: 5,
    strikeDecimals: 0,
    sigmaFloor: 1.3e-4,
  },
];

module.exports = {
  PROGRAM_ID,
  MUSDC_MINT,
  RPC_URL,
  FAUCET_URL,
  ENGINE_KEYPAIR_PATH,
  MARKET_DURATION_SECS,
  MARKET_DEPOSIT_USDC,
  ASSETS,
};
