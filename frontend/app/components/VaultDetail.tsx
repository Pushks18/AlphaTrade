"use client";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  META_AGENT_VAULT_ABI,
  META_AGENT_REGISTRY_ABI,
  ERC20_ABI,
  BASKET_LABELS,
  getAddresses,
} from "../lib/contracts";
import {
  ENS_KEYS,
  loadBindings,
  saveBinding,
  getBoundName,
  getRecords,
  setRecords,
} from "../lib/ens";
import { getQuote, BASKET_TOKENS, type TokenSymbol, type QuoteResult } from "../lib/uniswap";
import { submitTradeViaKeeperhub, type KeeperhubResponse } from "../lib/keeperhub";

interface Props {
  vaultAddr: string;
  agentId:   number;
  chainId:   number;
  onClose:   () => void;
}

interface NavPoint  { block: number; ts: number; nav: number; }
interface TradeRow  { block: number; navBefore: number; }
interface DepositRow{ sender: string; assets: number; shares: number; block: number; }

function fmtUsdc(raw: bigint, dec = 6): number {
  return Number(raw) / 10 ** dec;
}
function short(addr: string) { return addr.slice(0, 6) + "…" + addr.slice(-4); }

export default function VaultDetail({ vaultAddr, agentId, chainId, onClose }: Props) {
  const addr = getAddresses(chainId);
  const [nav,         setNav]         = useState<number>(0);
  const [supply,      setSupply]      = useState<number>(0);
  const [perfFeeBps,  setPerfFeeBps]  = useState<number>(0);
  const [operator,    setOperator]    = useState<string>("");
  const [ensName,     setEnsName]     = useState<string>(getBoundName(vaultAddr) ?? "");
  const [ensRecords,  setEnsRecords]  = useState<Record<string, string>>({});
  const [ensInput,    setEnsInput]    = useState<string>("");
  const [ensBusy,     setEnsBusy]     = useState(false);
  const [ensMsg,      setEnsMsg]      = useState<string>("");
  const [uniQuotes,   setUniQuotes]   = useState<QuoteResult[] | null>(null);
  const [uniBusy,     setUniBusy]     = useState(false);
  const [uniAmt,      setUniAmt]      = useState<number>(1000);
  const [khResp,      setKhResp]      = useState<KeeperhubResponse | null>(null);
  const [khBusy,      setKhBusy]      = useState<string | null>(null);
  const [navHistory,  setNavHistory]  = useState<NavPoint[]>([]);
  const [holdings,    setHoldings]    = useState<{ symbol: string; balance: number; decimals: number }[]>([]);
  const [trades,      setTrades]      = useState<TradeRow[]>([]);
  const [deposits,    setDeposits]    = useState<DepositRow[]>([]);
  const [models,      setModels]      = useState<number[]>([]);
  const [loading,     setLoading]     = useState(false);

  useEffect(() => {
    if (!vaultAddr) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const p = new ethers.BrowserProvider(window.ethereum);
        const vault    = new ethers.Contract(vaultAddr, META_AGENT_VAULT_ABI, p);
        const registry = new ethers.Contract(addr.MetaAgentRegistry, META_AGENT_REGISTRY_ABI, p);

        const [navRaw, supplyRaw, fee, basketAddrs] = await Promise.all([
          vault.totalAssets(),
          vault.totalSupply(),
          vault.perfFeeBps(),
          Promise.all([0,1,2,3,4].map(i => vault.basket(i))),
        ]);
        if (cancelled) return;
        setNav(fmtUsdc(navRaw));
        setSupply(Number(supplyRaw) / 1e18);
        setPerfFeeBps(Number(fee));

        // ENS records: read text records for the bound name (if any).
        // Works on Sepolia/mainnet; silently no-ops elsewhere.
        if (ensName && (chainId === 1 || chainId === 11155111)) {
          getRecords(p, ensName, Object.values(ENS_KEYS)).then(r => {
            if (!cancelled) setEnsRecords(r);
          });
        }

        // Operator NFT holder
        try {
          const op = await registry.ownerOf(agentId);
          if (!cancelled) setOperator(op);
        } catch { /* not minted */ }

        // Holdings: ERC20 balance of vault for each basket token
        const bal = await Promise.all(basketAddrs.map(async (t: string) => {
          try {
            const erc = new ethers.Contract(t, ERC20_ABI, p);
            const [b, d, s] = await Promise.all([
              erc.balanceOf(vaultAddr),
              erc.decimals(),
              erc.symbol().catch(() => ""),
            ]);
            return { symbol: s || "?", balance: Number(b) / 10 ** Number(d), decimals: Number(d) };
          } catch { return { symbol: "?", balance: 0, decimals: 18 }; }
        }));
        if (!cancelled) setHoldings(bal);

        // Events: pull from vault deploy block to head. On Anvil this is cheap.
        const head = await p.getBlockNumber();
        // Cap lookback at 50_000 blocks to keep it snappy on long chains.
        const fromBlock = Math.max(0, head - 50_000);

        const [depEvts, wdEvts, tradeEvts, harvestEvts] = await Promise.all([
          vault.queryFilter(vault.filters.Deposit(),     fromBlock, head),
          vault.queryFilter(vault.filters.Withdraw(),    fromBlock, head),
          vault.queryFilter(vault.filters.TradeExecuted(), fromBlock, head),
          vault.queryFilter(vault.filters.Harvested(),  fromBlock, head),
        ]);
        if (cancelled) return;

        const depRows: DepositRow[] = depEvts.slice(-8).reverse().map((e: any) => ({
          sender: e.args[0],
          assets: fmtUsdc(e.args[2]),
          shares: Number(e.args[3]) / 1e18,
          block:  e.blockNumber,
        }));
        setDeposits(depRows);

        const tradeRows: TradeRow[] = tradeEvts.slice(-8).reverse().map((e: any) => ({
          block:     Number(e.args[0]),
          navBefore: fmtUsdc(e.args[1]),
        }));
        setTrades(tradeRows);

        // NAV history: combine deposit + withdraw + trade + harvest events
        // Each is a snapshot of NAV at a point in time.
        const points: NavPoint[] = [];
        // First point: 0 at deploy (assume first deposit block - 1 or fromBlock)
        points.push({ block: fromBlock, ts: 0, nav: 0 });
        // Walk events in chronological order, recompute NAV.
        let running = 0;
        const all = [
          ...depEvts.map((e: any)     => ({ block: e.blockNumber, kind: "dep",     value: fmtUsdc(e.args[2]) })),
          ...wdEvts.map((e: any)      => ({ block: e.blockNumber, kind: "wd",      value: fmtUsdc(e.args[3]) })),
          ...tradeEvts.map((e: any)   => ({ block: e.blockNumber, kind: "trade",   value: fmtUsdc(e.args[1]) })),
          ...harvestEvts.map((e: any) => ({ block: e.blockNumber, kind: "harvest", value: fmtUsdc(e.args[0]) })),
        ].sort((a, b) => a.block - b.block);

        for (const e of all) {
          if (e.kind === "dep")     running += e.value;
          else if (e.kind === "wd") running -= e.value;
          else                      running  = e.value; // trade/harvest carry NAV snapshot
          points.push({ block: e.block, ts: 0, nav: Math.max(0, running) });
        }
        // End point: now
        points.push({ block: head, ts: Date.now(), nav: fmtUsdc(navRaw) });
        setNavHistory(points);

        // Models held: scan ModelDeposited events
        try {
          const md = await vault.queryFilter(vault.filters.ModelDeposited(), fromBlock, head);
          if (!cancelled) setModels(md.map((e: any) => Number(e.args[0])));
        } catch { /* skip */ }

      } catch { /* swallow */ }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [vaultAddr, agentId, chainId, addr.MetaAgentRegistry]);

  // ── tiny SVG line chart for NAV history ─────────────────────────────────
  const chart = (() => {
    if (navHistory.length < 2) return null;
    const W = 460, H = 120, P = 8;
    const xs = navHistory.map(p => p.block);
    const ys = navHistory.map(p => p.nav);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = 0, yMax = Math.max(0.01, Math.max(...ys)) * 1.1;
    const sx = (x: number) => P + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - 2 * P);
    const sy = (y: number) => H - P - ((y - yMin) / (yMax - yMin)) * (H - 2 * P);
    const path = navHistory.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.block).toFixed(1)} ${sy(p.nav).toFixed(1)}`).join(" ");
    const area = `${path} L ${sx(xMax).toFixed(1)} ${H - P} L ${sx(xMin).toFixed(1)} ${H - P} Z`;
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id="navg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--blue)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0"   />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#navg)" />
        <path d={path} fill="none" stroke="var(--blue)" strokeWidth="1.5" />
      </svg>
    );
  })();

  // ── pie/bar chart for holdings ──────────────────────────────────────────
  const navTotal = holdings.reduce((s, h) => s + h.balance, 0); // crude — assumes 1:1 USD
  const colors = ["#2563eb", "#7c3aed", "#059669", "#ea580c", "#0891b2"];

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", justifyContent: "flex-end", zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)", height: "100%", overflowY: "auto",
          background: "var(--bg)", padding: 24,
          boxShadow: "-12px 0 24px rgba(0,0,0,0.12)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600, letterSpacing: "0.05em" }}>
              VAULT DETAIL
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>Agent #{agentId}</h2>
          </div>
          <button
            onClick={onClose}
            style={{ border: "none", background: "var(--bg-card)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >
            ✕ Close
          </button>
        </div>

        {/* NAV card + chart */}
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600, letterSpacing: "0.05em" }}>
              NET ASSET VALUE
            </span>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              {loading ? "loading…" : `${navHistory.length} pts`}
            </span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums", marginBottom: 8 }}>
            {nav.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-secondary)", marginLeft: 6 }}>USDC</span>
          </div>
          {chart || <div style={{ height: 120, color: "var(--text-tertiary)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>No history yet — deposit or trade to populate</div>}
        </div>

        {/* Vault metadata */}
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Vault Info</div>
          <Row label="Vault address"   value={<code style={{ fontSize: 11 }}>{short(vaultAddr)}</code>} />
          <Row label="Operator"        value={operator ? <code style={{ fontSize: 11 }}>{short(operator)}</code> : "—"} />
          <Row label="Performance fee" value={`${(perfFeeBps / 100).toFixed(2)}%`} />
          <Row label="Total shares"    value={supply.toLocaleString("en-US", { maximumFractionDigits: 4 })} />
          <Row label="Models held"     value={models.length === 0 ? "none" : models.map(m => `#${m}`).join(", ")} />
        </div>

        {/* ENS identity ─────────────────────────────────────────── */}
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>ENS Identity</div>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
              {(chainId === 1 || chainId === 11155111) ? "Live ENS" : "ENS available on Sepolia / Mainnet"}
            </span>
          </div>

          {ensName ? (
            <>
              <Row label="Name" value={
                <a href={`https://app.ens.domains/${ensName}`} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "underline", fontWeight: 600, fontSize: 12 }}>
                  {ensName} ↗
                </a>
              }/>
              {Object.entries(ENS_KEYS).map(([keyLabel, recKey]) => {
                const v = ensRecords[recKey];
                if (!v) return null;
                return <Row key={recKey} label={keyLabel} value={<code style={{ fontSize: 11 }}>{v.length > 48 ? v.slice(0, 44) + "…" : v}</code>} />;
              })}

              <button
                disabled={ensBusy || !(chainId === 1 || chainId === 11155111)}
                onClick={async () => {
                  setEnsBusy(true); setEnsMsg("");
                  try {
                    const p = new ethers.BrowserProvider(window.ethereum);
                    const s = await p.getSigner();
                    const records: Array<[string, string]> = [
                      [ENS_KEYS.vault,      vaultAddr],
                      [ENS_KEYS.description,`AlphaTrade meta-agent #${agentId}, ${(perfFeeBps/100).toFixed(0)}% perf fee`],
                      [ENS_KEYS.sharpe,     "0"],
                    ];
                    const r = await setRecords(s, p, ensName, records);
                    setEnsMsg(r ? `Records set ✓ (${r.hash.slice(0,10)}…)` : "Failed");
                    // Refresh shown records
                    const fresh = await getRecords(p, ensName, Object.values(ENS_KEYS));
                    setEnsRecords(fresh);
                  } catch (e: any) {
                    setEnsMsg(`error: ${e.shortMessage ?? e.message?.slice(0, 60)}`);
                  }
                  setEnsBusy(false);
                }}
                style={{
                  marginTop: 10, width: "100%", padding: "6px 12px", fontSize: 11, fontWeight: 600,
                  border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-card)",
                  color: "var(--text-primary)", cursor: "pointer",
                }}
              >
                {ensBusy ? "Writing…" : "↗ Update text records on " + ensName}
              </button>
              {ensMsg && <div style={{ fontSize: 10, marginTop: 6, color: ensMsg.startsWith("error") ? "var(--red)" : "var(--green)" }}>{ensMsg}</div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginBottom: 8 }}>
                No ENS name bound. Operators can bind a name they own (e.g. <code>myagent.eth</code>) so the vault is discoverable across web3.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="input input-sm"
                  placeholder="myagent.eth"
                  value={ensInput}
                  onChange={e => setEnsInput(e.target.value)}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button
                  onClick={() => {
                    if (!ensInput.trim()) return;
                    saveBinding(vaultAddr, ensInput.trim());
                    setEnsName(ensInput.trim());
                  }}
                  style={{
                    padding: "4px 12px", fontSize: 11, fontWeight: 600,
                    border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-card)",
                    cursor: "pointer", color: "var(--text-primary)",
                  }}
                >
                  Bind
                </button>
              </div>
            </>
          )}
        </div>

        {/* Holdings */}
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Basket Holdings</div>
          {holdings.map((h, i) => {
            const pct = navTotal > 0 ? (h.balance / navTotal) * 100 : 0;
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{BASKET_LABELS[i]} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>({h.symbol})</span></span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {h.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })} <span style={{ color: "var(--text-tertiary)" }}>{pct.toFixed(0)}%</span>
                  </span>
                </div>
                <div style={{ background: "var(--bg-muted)", height: 6, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: colors[i] }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Uniswap live routing ─────────────────────────────────── */}
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Live Uniswap Routing</div>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
              {uniQuotes && uniQuotes[0]?.source === "uniswap-api" ? "via Trading API" : "preview"}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginBottom: 10 }}>
            Quote what the agent would receive if it swapped {uniAmt.toLocaleString()} USDC into each basket asset right now.
            The on-chain TradingExecutor uses single-pool exactInputSingle; this surfaces what the optimal Uniswap-API route would return for comparison.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              type="number"
              value={uniAmt}
              min={1}
              onChange={e => setUniAmt(Number(e.target.value) || 0)}
              className="input input-sm"
              style={{ flex: 1, fontSize: 12 }}
            />
            <span style={{ alignSelf: "center", fontSize: 11, color: "var(--text-tertiary)" }}>USDC →</span>
            <button
              disabled={uniBusy || uniAmt <= 0}
              onClick={async () => {
                setUniBusy(true);
                try {
                  const targetChain = (chainId === 1 || chainId === 11155111) ? chainId : 1;
                  const results = await Promise.all(
                    BASKET_TOKENS.map(t => getQuote(targetChain, "USDC", t, uniAmt))
                  );
                  setUniQuotes(results);
                } finally { setUniBusy(false); }
              }}
              style={{
                padding: "4px 14px", fontSize: 11, fontWeight: 600,
                border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-card)",
                cursor: "pointer", color: "var(--text-primary)",
              }}
            >
              {uniBusy ? "Routing…" : "Get Quotes"}
            </button>
          </div>
          {uniQuotes && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {uniQuotes.map((q, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "50px 1fr 110px 100px",
                  alignItems: "center", padding: "8px 10px", gap: 6,
                  background: "var(--bg-raised)", borderRadius: 4, fontSize: 12,
                }}>
                  <span style={{ fontWeight: 600 }}>{q.tokenOut}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{q.routeText}</span>
                  <span style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                    {parseFloat(q.amountOut).toLocaleString("en-US", { maximumFractionDigits: 6 })}
                  </span>
                  <button
                    disabled={khBusy !== null}
                    onClick={async () => {
                      setKhBusy(q.tokenOut);
                      setKhResp(null);
                      const r = await submitTradeViaKeeperhub({
                        tokenIn:  q.tokenIn,
                        tokenOut: q.tokenOut,
                        amount:   q.amountIn,
                        slippage: 0.5,
                        vault:    vaultAddr,
                      });
                      setKhResp(r);
                      setKhBusy(null);
                    }}
                    style={{
                      padding: "4px 6px", fontSize: 10, fontWeight: 600,
                      border: "1px solid var(--green-border)",
                      background: "var(--green-dim)", color: "var(--green)",
                      borderRadius: 3, cursor: "pointer",
                    }}
                    title="Submit this swap via KeeperHub for guaranteed execution (retry, gas opt, MEV protection)"
                  >
                    {khBusy === q.tokenOut ? "Routing…" : "Exec via KeeperHub"}
                  </button>
                </div>
              ))}
              {uniQuotes[0]?.notice && (
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 4 }}>
                  ⓘ {uniQuotes[0].notice}
                </div>
              )}
              {khResp && (
                <div style={{
                  marginTop: 8, padding: "10px 12px", fontSize: 11,
                  background: khResp.error ? "var(--red-dim)" : "var(--green-dim)",
                  border: `1px solid ${khResp.error ? "var(--red-border)" : "var(--green-border)"}`,
                  borderRadius: 4,
                }}>
                  {khResp.error ? (
                    <span style={{ color: "var(--red)" }}>KeeperHub error: {khResp.error}</span>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        ✓ KeeperHub workflow created ({khResp.mode === "demo" ? "demo mode" : "live"})
                      </div>
                      {khResp.workflowId && <div>Workflow ID: <code style={{ fontSize: 10 }}>{khResp.workflowId}</code></div>}
                      {khResp.txHash     && <div>Tx hash: <code style={{ fontSize: 10 }}>{khResp.txHash.slice(0,10)}…{khResp.txHash.slice(-6)}</code></div>}
                      {khResp.notice     && <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 4 }}>{khResp.notice}</div>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent trades */}
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Recent Trades</div>
          {trades.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "8px 0" }}>
              No trades yet. The operator must call <code>executeTrade</code> from the Python runtime.
            </div>
          ) : trades.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i === 0 ? undefined : "1px solid var(--border)", fontSize: 12 }}>
              <span style={{ color: "var(--text-tertiary)" }}>block #{t.block}</span>
              <span>NAV before: <strong>{t.navBefore.toFixed(2)} USDC</strong></span>
            </div>
          ))}
        </div>

        {/* Recent deposits */}
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Recent Deposits</div>
          {deposits.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "8px 0" }}>No deposits yet.</div>
          ) : deposits.map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i === 0 ? undefined : "1px solid var(--border)", fontSize: 12 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{short(d.sender)}</span>
              <span>+{d.assets.toFixed(2)} USDC <span style={{ color: "var(--text-tertiary)" }}>({d.shares.toFixed(4)} shares)</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, borderTop: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
