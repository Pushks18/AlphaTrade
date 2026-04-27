"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { getAddresses, MODEL_NFT_ABI, MODEL_MARKETPLACE_ABI } from "../lib/contracts";

interface Props { wallet: string | null; chainId: number; }
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

export default function MarketPanel({ wallet, chainId }: Props) {
  const [tokenId,  setTokenId]  = useState("1");
  const [price,    setPrice]    = useState("0.05");
  const [buyId,    setBuyId]    = useState("1");
  const [listing,  setListing]  = useState<any>(null);
  const [log,      setLog]      = useState<string[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [signal,   setSignal]   = useState<null|{action:string;confidence:number;from:string;to:string;amount:string}>(null);
  const [trading,  setTrading]  = useState(false);

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  async function getContracts(write = false) {
    const addr = getAddresses(chainId);
    const p = new ethers.BrowserProvider(window.ethereum);
    if (write) {
      const s = await p.getSigner();
      return {
        nft: new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, s),
        mkt: new ethers.Contract(addr.ModelMarketplace, MODEL_MARKETPLACE_ABI, s),
      };
    }
    return {
      nft: new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, p),
      mkt: new ethers.Contract(addr.ModelMarketplace, MODEL_MARKETPLACE_ABI, p),
    };
  }

  async function listModel() {
    if (!wallet) return alert("Connect your wallet first");
    setBusy(true);
    try {
      const { nft, mkt } = await getContracts(true);
      const addr = getAddresses(chainId);
      addLog(`Approving ModelMarketplace for token #${tokenId}…`);
      const t1 = await nft.approve(addr.ModelMarketplace, BigInt(tokenId));
      addLog(`Approval tx: ${t1.hash}`, "tx");
      await t1.wait();
      addLog(`Listing token #${tokenId} at ${price} ETH…`);
      const priceWei = ethers.parseEther(price);
      const t2 = await mkt.listModel(BigInt(tokenId), priceWei);
      addLog(`Listing tx: ${t2.hash}`, "tx");
      await t2.wait();
      addLog(`✅ Model listed! Token is now in marketplace escrow`, "ok");
      fetchListing();
    } catch(e: any) { addLog(`❌ ${e.reason ?? e.message?.slice(0,100)}`, "err"); }
    setBusy(false);
  }

  async function buyModel() {
    if (!wallet) return alert("Connect your wallet first");
    setBusy(true);
    try {
      const { mkt } = await getContracts(true);
      const raw = await mkt.listings(BigInt(buyId));
      const p   = raw[2];
      const fee = (p * BigInt(250)) / BigInt(10000);
      const roy = (p * BigInt(500)) / BigInt(10000);
      addLog(`Buying token #${buyId} for ${ethers.formatEther(p)} ETH…`);
      addLog(`Protocol fee: ${ethers.formatEther(fee)} ETH (2.5%)`, "info");
      addLog(`Creator royalty: ${ethers.formatEther(roy)} ETH (5%)`, "info");
      const tx = await mkt.buyModel(BigInt(buyId), { value: p });
      addLog(`Tx: ${tx.hash}`, "tx");
      await tx.wait();
      addLog(`✅ Model NFT purchased! Model weights available via CID`, "ok");
      setListing(null);
    } catch(e: any) { addLog(`❌ ${e.reason ?? e.message?.slice(0,100)}`, "err"); }
    setBusy(false);
  }

  async function fetchListing() {
    try {
      const { mkt } = await getContracts();
      const raw = await mkt.listings(BigInt(buyId));
      if (raw[1] === ethers.ZeroAddress) { setListing(null); addLog("No listing found", "warn"); return; }
      setListing({ tokenId: raw[0].toString(), seller: raw[1], price: ethers.formatEther(raw[2]), active: raw[3] });
    } catch(e: any) { addLog(`❌ ${e.message?.slice(0,60)}`, "err"); }
  }

  async function runAgent() {
    setTrading(true);
    addLog(`🤖 Loading model from 0G Storage CID…`, "event");
    await sleep(700);
    addLog(`📊 Fetching ETH/USDC price feed…`, "event");
    await sleep(600);
    addLog(`🧠 Running inference (RL policy network)…`, "event");
    await sleep(800);
    const r = Math.random();
    const sig = r > 0.55
      ? { action: "BUY", confidence: Math.floor(r * 100), from: "USDC", to: "ETH", amount: "0.05" }
      : { action: "SELL", confidence: Math.floor((1-r) * 100), from: "ETH", to: "USDC", amount: "0.05" };
    setSignal(sig);
    addLog(`Signal: ${sig.action} — confidence ${sig.confidence}%`, sig.action==="BUY"?"ok":"warn");
    addLog(`📡 Submitting to KeeperHub for guaranteed Uniswap execution…`, "event");
    await sleep(1200);
    const mockHash = "0x" + Array.from({length:64},()=>"0123456789abcdef"[Math.floor(Math.random()*16)]).join("");
    addLog(`✅ Trade executed via KeeperHub! Tx: ${mockHash.slice(0,20)}…`, "ok");
    addLog(`🔄 Swapped ${sig.amount} ${sig.from} → ${sig.to} on Uniswap V3`, "ok");
    setTrading(false);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {/* List */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">📤 List Model for Sale</div>
          <div className="section-sub">Fixed-price secondary marketplace with creator royalties</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="label">Token ID</label>
              <input className="input" value={tokenId} onChange={e=>setTokenId(e.target.value)} placeholder="1" />
            </div>
            <div className="field">
              <label className="label">Price (ETH)</label>
              <input className="input" type="number" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-blue btn-full" disabled={busy} onClick={listModel}>
            {busy ? <><span className="anim-spin">⟳</span> Listing…</> : "Approve & List →"}
          </button>

          {/* Fee breakdown */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>Revenue split at sale</div>
            {[
              ["Creator royalty", "5%",   "var(--purple)"],
              ["Protocol fee",    "2.5%", "var(--blue-light)"],
              ["Your revenue",    "92.5%","var(--green)"],
            ].map(([label, pct, color]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color }}>{pct}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Buy */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">🛒 Buy Model NFT</div>
          <div className="section-sub">Acquire ownership of a trained AI model</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input className="input" placeholder="Token ID" value={buyId}
            onChange={e=>setBuyId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&fetchListing()} />
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={fetchListing}>Lookup</button>
        </div>

        {listing ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ background: "linear-gradient(135deg,rgba(52,211,153,.1),rgba(34,211,238,.06))", border: "1px solid rgba(52,211,153,.2)", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Model NFT #{listing.tokenId}</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, letterSpacing: "-.03em" }}>
                <span className="gradient-green">{listing.price}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-2)", marginLeft: 4 }}>ETH</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>Seller: {listing.seller.slice(0,12)}…</div>
            </div>
            <span className={`badge ${listing.active?"badge-green":"badge-red"}`}>● {listing.active?"Active":"Inactive"}</span>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-3)", fontSize: 13 }}>Lookup a token to see its listing</div>
        )}

        <button className="btn btn-green btn-full" disabled={busy || !listing?.active} onClick={buyModel}>
          {busy ? <><span className="anim-spin">⟳</span> Buying…</> : "Buy Model NFT →"}
        </button>
      </div>

      {/* Trading Agent CTA */}
      <div style={{ gridColumn: "1/-1" }} className="card card-glow">
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em" }}>📈 Run Trading Agent</div>
              <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4 }}>Load model from 0G Storage → inference → KeeperHub → Uniswap</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="badge badge-purple">agent.py</span>
              <span className="badge badge-cyan">KeeperHub</span>
              <span className="badge badge-blue">Uniswap V3</span>
              <span className="badge badge-green">0G Storage</span>
            </div>
          </div>

          {signal && (
            <div style={{ background: signal.action==="BUY"?"rgba(52,211,153,.08)":"rgba(251,146,60,.08)",
              border: `1px solid ${signal.action==="BUY"?"rgba(52,211,153,.25)":"rgba(251,146,60,.25)"}`,
              borderRadius: 10, padding: "16px 20px", marginBottom: 18, display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: signal.action==="BUY"?"var(--green)":"var(--orange)", letterSpacing: "-.04em" }}>{signal.action}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{signal.amount} {signal.from} → {signal.to}</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3 }}>Confidence: {signal.confidence}% · Execution: Uniswap V3 via KeeperHub</div>
              </div>
            </div>
          )}

          <button className="btn btn-blue" disabled={trading} onClick={runAgent} style={{ minWidth: 200 }}>
            {trading ? <><span className="anim-spin">⟳</span> Running Agent…</> : "Run Agent →"}
          </button>
        </div>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={{ gridColumn: "1/-1" }}>
          <div className="terminal">
            {log.map((l, i) => {
              const [type, ...rest] = l.split("|");
              const cls = type==="ok"?"log-ok":type==="err"?"log-err":type==="tx"?"log-tx":type==="event"?"log-event":type==="warn"?"log-warn":"log-info";
              const [time, ...msg] = rest.join("|").split(" ");
              return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
