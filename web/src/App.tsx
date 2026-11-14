import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { decodeName, type MarketAccount } from "@pm-amm/sdk";
import { useBurnerWallet } from "./useBurnerWallet";
import { fetchMarkets, marketState, minOutput, quoteSwap } from "./pm-amm-helpers";

const REPO = "https://github.com/Axonprotocol404/pulse-markets";
const PROGRAM = "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y";

interface FeedMarket {
  pda: string;
  asset: string;
  strike: number;
  seedBps: number;
  createdTs: number;
  endTs: number;
  winner: string | null;
  settlePrice: number | null;
}
interface FeedEvent {
  ts: number;
  kind: string;
  actor?: string;
  asset?: string;
  market: string;
  tx?: string;
  direction?: string;
  amountUsdc?: number;
  fairYes?: number;
  marketYes?: number;
  winner?: string;
  settlePrice?: number;
  amount?: number;
  what?: string;
}
interface Feed {
  generatedAt: number;
  engineWallet: string;
  markets: FeedMarket[];
  activity: FeedEvent[];
  totals: { marketsCreated: number; agentSwaps: number; agentVolumeUsdc: number; claims: number };
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const solscanAcct = (a: string) => `https://solscan.io/account/${a}?cluster=devnet`;
function timeLeft(endTs: number): string {
  const s = endTs - Math.floor(Date.now() / 1000);
  if (s <= 0) return "expired";
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m left` : `${m}m ${s % 60}s left`;
}
const hhmm = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export default function App() {
  const burner = useBurnerWallet();
  const { client, connection, publicKey, balances, status, error } = burner;
  const [feed, setFeed] = useState<Feed | null>(null);
  const [accounts, setAccounts] = useState<Map<string, MarketAccount>>(new Map());
  const [positions, setPositions] = useState<Map<string, { yes: number; no: number }>>(new Map());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}feed.json`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setFeed)
      .catch(() => setNotice("Could not load the agent feed snapshot."));
  }, []);

  const loadMarkets = useCallback(async () => {
    if (!client || !feed || !publicKey) return;
    const pdas = feed.markets.map((m) => new PublicKey(m.pda));
    const fetched = await fetchMarkets(client, pdas);
    const map = new Map<string, MarketAccount>();
    const pos = new Map<string, { yes: number; no: number }>();
    await Promise.all(
      feed.markets.map(async (m, i) => {
        const acct = fetched[i];
        if (!acct) return;
        map.set(m.pda, acct);
        const bal = async (mint: PublicKey) => {
          try {
            const ata = getAssociatedTokenAddressSync(mint, publicKey);
            const r = await connection.getTokenAccountBalance(ata);
            return r.value.uiAmount ?? 0;
          } catch {
            return 0;
          }
        };
        pos.set(m.pda, { yes: await bal(acct.yesMint), no: await bal(acct.noMint) });
      }),
    );
    setAccounts(map);
    setPositions(pos);
  }, [client, feed, publicKey, connection]);

  useEffect(() => {
    loadMarkets().catch(() => {});
    const t = setInterval(() => {
      setTick((x) => x + 1);
      loadMarkets().catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [loadMarkets]);

  async function trade(pda: string, side: "yes" | "no") {
    if (!client) return;
    const acct = accounts.get(pda);
    if (!acct) return;
    const amt = Number(amounts[pda] ?? "5");
    if (!Number.isFinite(amt) || amt <= 0) return setNotice("Enter an amount in mUSDC.");
    setBusy(pda + side);
    setNotice(null);
    try {
      const dir = side === "yes" ? "usdcToYes" : "usdcToNo";
      const raw = Math.round(amt * 1e6);
      const quote = quoteSwap(acct, dir, raw);
      if (quote.out <= 0) throw new Error("Quote is zero — market may be at expiry.");
      const sig = await client.send.swap(new PublicKey(pda), dir, raw, minOutput(quote));
      setNotice(`Bought ${side.toUpperCase()} for ${amt} mUSDC. Tx ${short(sig)}`);
      await burner.refresh();
      await loadMarkets();
    } catch (e) {
      setNotice(`Trade failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function claim(pda: string) {
    if (!client) return;
    setBusy(pda + "claim");
    setNotice(null);
    try {
      const sig = await client.send.claimWinnings(new PublicKey(pda));
      setNotice(`Winnings claimed. Tx ${short(sig)}`);
      await burner.refresh();
      await loadMarkets();
    } catch (e) {
      setNotice(`Claim failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const markets = [...(feed?.markets ?? [])].sort((a, b) => {
    const ra = a.winner ? 1 : 0;
    const rb = b.winner ? 1 : 0;
    return ra - rb || b.endTs - a.endTs;
  });

  return (
    <div className="page">
      <header>
        <div>
          <h1>Pulse<span>Markets</span></h1>
          <p className="tag">Micro prediction markets, run end-to-end by AI agents on Predict's pm-AMM · Solana devnet</p>
        </div>
        <div className="wallet">
          {status === "ready" && publicKey ? (
            <>
              <div className="waddr">
                Burner wallet <a href={solscanAcct(publicKey.toBase58())} target="_blank" rel="noreferrer">{short(publicKey.toBase58())}</a>
              </div>
              <div className="wbal">
                {balances ? `${balances.usdc.toFixed(2)} mUSDC · ${balances.sol.toFixed(4)} SOL` : "…"}
              </div>
              <div className="wnote">Auto-funded with devnet test funds — no real money, ever.</div>
            </>
          ) : status === "error" ? (
            <div className="werr">Wallet funding failed: {error}</div>
          ) : (
            <div className="wnote">Creating & funding your devnet burner wallet…</div>
          )}
        </div>
      </header>

      {feed && (
        <section className="stats">
          <div><b>{feed.totals.marketsCreated}</b><span>markets created by the engine</span></div>
          <div><b>{feed.totals.agentSwaps}</b><span>agent trades</span></div>
          <div><b>{feed.totals.agentVolumeUsdc.toFixed(2)}</b><span>mUSDC agent volume</span></div>
          <div><b>{feed.totals.claims}</b><span>payout claims settled</span></div>
          <div>
            <b className="mono">{short(feed.engineWallet)}</b>
            <span>engine wallet — <a href={solscanAcct(feed.engineWallet)} target="_blank" rel="noreferrer">verify on Solscan</a></span>
          </div>
        </section>
      )}

      {notice && <div className="notice">{notice}</div>}

      <h2>Markets</h2>
      <div className="grid">
        {markets.map((m) => {
          const acct = accounts.get(m.pda);
          const ms = acct ? marketState(acct) : null;
          const pos = positions.get(m.pda) ?? { yes: 0, no: 0 };
          const resolved = Boolean(m.winner) || Boolean(ms?.resolved);
          const winner = m.winner ?? ms?.winner ?? null;
          const winPos = winner === "yes" ? pos.yes : winner === "no" ? pos.no : 0;
          const yesPct = ms ? Math.round(ms.price * 100) : Math.round(m.seedBps / 100);
          return (
            <article className="card" key={m.pda}>
              <div className="q">
                Will <b>{m.asset}</b> be above <b>${m.strike.toLocaleString()}</b> at {hhmm(m.endTs)}?
              </div>
              <div className="bar"><div className="fill" style={{ width: `${yesPct}%` }} /></div>
              <div className="prow">
                <span className="yes">YES {yesPct}%</span>
                <span className="muted">{resolved ? `settled · winner ${winner?.toUpperCase()}` : timeLeft(m.endTs)}</span>
                <span className="no">NO {100 - yesPct}%</span>
              </div>
              {acct && <div className="mname">{decodeName(acct.name)}</div>}
              <div className="pos">
                Your position: <b>{pos.yes.toFixed(2)} YES</b> · <b>{pos.no.toFixed(2)} NO</b>
                {m.settlePrice != null && <> · settled at ${m.settlePrice.toLocaleString()}</>}
              </div>
              {!resolved ? (
                <div className="trade">
                  <input
                    type="number" min="0.1" step="0.1" placeholder="5"
                    value={amounts[m.pda] ?? "5"}
                    onChange={(e) => setAmounts((s) => ({ ...s, [m.pda]: e.target.value }))}
                  />
                  <span className="unit">mUSDC</span>
                  <button className="buy yes" disabled={status !== "ready" || busy !== null} onClick={() => trade(m.pda, "yes")}>
                    {busy === m.pda + "yes" ? "…" : "Buy YES"}
                  </button>
                  <button className="buy no" disabled={status !== "ready" || busy !== null} onClick={() => trade(m.pda, "no")}>
                    {busy === m.pda + "no" ? "…" : "Buy NO"}
                  </button>
                </div>
              ) : winPos > 0 ? (
                <button className="claim" disabled={busy !== null} onClick={() => claim(m.pda)}>
                  {busy === m.pda + "claim" ? "Claiming…" : `Claim ${winPos.toFixed(2)} winning shares`}
                </button>
              ) : (
                <div className="muted">Market settled on-chain by the resolver agent.</div>
              )}
              <a className="plink" href={solscanAcct(m.pda)} target="_blank" rel="noreferrer">market account ↗</a>
            </article>
          );
        })}
        {markets.length === 0 && <p className="muted">Loading markets…</p>}
      </div>

      <h2>Agent activity</h2>
      <p className="muted">
        Every row is a real devnet transaction by an autonomous agent: the market-making engine, the momentum
        forecaster, the market maker, or the resolver. Snapshot {feed ? `from ${hhmm(feed.generatedAt)}` : ""} — live
        state is read from chain above.
      </p>
      <ul className="feed">
        {(feed?.activity ?? []).slice(0, 14).map((ev, i) => (
          <li key={i}>
            <span className={`kind k-${ev.kind}`}>{ev.kind.replace("_", " ")}</span>
            <span className="what">
              {ev.kind === "market_created" && <>engine opened {ev.asset} market</>}
              {ev.kind === "swap" && (
                <>{ev.actor} bought {ev.direction === "usdcToYes" ? "YES" : "NO"} on {ev.asset} for {ev.amountUsdc?.toFixed(2)} mUSDC
                  {typeof ev.fairYes === "number" && <> (model fair value {(ev.fairYes * 100).toFixed(0)}%)</>}</>
              )}
              {ev.kind === "resolved" && <>resolver settled {ev.asset} → {ev.winner?.toUpperCase()} at ${ev.settlePrice?.toLocaleString()}</>}
              {ev.kind === "claim" && <>{ev.actor} claimed {ev.amount?.toFixed(2)} mUSDC ({ev.what})</>}
            </span>
            <span className="when">{hhmm(ev.ts)}</span>
            {ev.tx && <a href={solscanTx(ev.tx)} target="_blank" rel="noreferrer">tx ↗</a>}
          </li>
        ))}
      </ul>

      <footer>
        <p>
          PulseMarkets is a hackathon prototype on <b>Solana devnet</b>: all funds are valueless test tokens from the
          pm-AMM faucet. Markets are created and settled by software agents; settlement uses a median spot-price
          adapter (Kraken + Coinbase) and is fully reproducible from the open-source engine.
        </p>
        <p>
          <a href={REPO} target="_blank" rel="noreferrer">Source code</a> ·{" "}
          <a href={solscanAcct(PROGRAM)} target="_blank" rel="noreferrer">pm-AMM program</a> · Built on Predict's
          pm-AMM for the Solana Perps &amp; Prediction Markets hackathon.
        </p>
      </footer>
    </div>
  );
}
