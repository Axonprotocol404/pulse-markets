# PulseMarkets

**Micro prediction markets, run end-to-end by AI agents** — on Predict's
[pm-AMM](https://pm-amm.dev) (Solana **devnet**).

**Live app:** https://axonprotocol404.github.io/pulse-markets/
**Program:** `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` (same ID on devnet; all funds are valueless devnet mUSDC)

Built for the Solana *Perps & Prediction Markets* hackathon (main track) and the
Predict pm-AMM sponsor bounty.

## What it does

Every hour, an autonomous **market-making engine** opens short-horizon binary
markets — *"Will SOL be above $73 at 14:00 UTC?"* — for SOL, BTC and ETH on the
pm-AMM, seeding each from a quantitative fair-value model (the pm-AMM's own
Gaussian `capitalPhi` formula fed by live spot prices). A swarm of agents then
runs the market end-to-end, with no human in the loop:

| Agent | Role |
|---|---|
| **Forecaster** | Momentum model (EWMA of returns + mean reversion to the market price). Trades only when its fair value disagrees with the market by > 5 pp, sized by edge, capped per position. |
| **Market maker** | Two-sided liquidity provider: buys whichever side is cheaper than 0.50, capped per market, exits by holding to settlement. |
| **Resolver** | After expiry, settles each market from a manipulation-resistant spot median and triggers payout claims (LP residuals, agent winnings). |
| **Users** | Anyone can trade the same markets from the web app with a burner wallet that is created and faucet-funded in the browser — no signup, no real funds. |

All state changes are real devnet transactions; every agent action in the UI's
activity feed links to its Solscan record.

**Settlement oracle:** spot prices come from a median of two independent public
exchanges (Kraken + Coinbase), sampled 60 s after expiry for resolution and
live for seeding. The feed layer is oracle-agnostic: Pyth Hermes IDs for
SOL/BTC/ETH are verified and wired behind config, ready to swap in where the
endpoint is openly reachable.

## Layout

```
engine/    market-making engine, forecaster + market-maker agents, resolver,
           exact accrual-aware quote math (ported from the official pm-AMM
           helpers), feed adapters, chain + state helpers
web/       React + Vite app (burner-wallet trading UI per the official kit)
scripts/   wallet funding (devnet faucet), agent wallet generation, status
test/      math unit tests (node --test) + full lifecycle probe
```

## Run it

```bash
# engine + agents (Node 20+)
npm install
node scripts/fund.cjs        # claim devnet faucet for the engine wallet
npm run engine               # create this hour's markets
npm run agents               # forecaster + market maker trade
npm run resolver             # settle expired markets + claim payouts
npm run status               # scoreboard
npm test                     # 8/8 math tests

# web app
cd web && npm install && npm run dev
```

Engine/agent keypairs live outside the repo (`../secrets/`, `~/workspace/bounty/`)
and are never committed. `state/state.json` (git-ignored) is the engine's local
market registry + activity log; `node scripts/export-feed.cjs` snapshots it to
`web/public/feed.json` for the UI.

## Why this wins (design notes)

- **The AMM wants a market maker — we automated it.** The pm-AMM seeds every
  market with a `price0` and leaves the rest to flow. PulseMarkets supplies the
  missing operator: creation, seeding, flow, settlement, claims — the full
  lifecycle as software.
- **Seeding is model-based, not a coin flip.** `price0 = Φ(ln(S/K)/(σ√T))` with
  σ from realised volatility — the same Gaussian the AMM's capital model uses,
  so markets open at a defensible fair price.
- **Quoting is exact.** Swap quotes use the accrual-aware math from Predict's
  official helpers (time-accrued reserves + fee split), not the naive curve —
  the agents never trade on a stale price.
- **Settlement is manipulation-resistant and reproducible.** A two-exchange
  median at a fixed post-expiry instant; anyone can recompute the winner from
  public data.

## Status (15 Nov 2026)

Live on devnet: hourly SOL/BTC/ETH markets created, agent trades executed,
full lifecycle (create → trade → resolve → claim) proven on-chain. See the
live app and the activity feed for current traction.
