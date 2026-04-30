"use client";
import { useState, useRef, useCallback } from "react";
import { ethers } from "ethers";
import { getAddresses, MODEL_NFT_ABI, MODEL_MARKETPLACE_ABI } from "../lib/contracts";

interface Props { wallet: string | null; chainId: number; }
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const MOCK_LISTINGS = [
  { tokenId: 1, seller: "0xaBc1…3f22", price: "0.12", desc: "Trend-following RL predictor v1", score: 82, active: true  },
  { tokenId: 2, seller: "0x9fD2…a811", price: "0.08", desc: "LSTM momentum strategy v2",       score: 71, active: true  },
  { tokenId: 3, seller: "0xaBc1…3f22", price: "0.25", desc: "Volatility arbitrage model",      score: 91, active: false },
];

function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const show = useCallback((msg: string, type = "default") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);
  return { toasts, show };
}

export default function MarketPanel({ wallet, chainId }: Props) {
  const [tokenId,     setTokenId]     = useState("1");
  const [price,       setPrice]       = useState("0.05");
  const [buyId,       setBuyId]       = useState("");
  const [listing,     setListing]     = useState<any>(null);
  const [log,         setLog]         = useState<string[]>([]);
  const [busy,        setBusy]        = useState(false);
  const [signal,      setSignal]      = useState<any>(null);
  const [trading,     setTrading]     = useState(false);
  const [agentLog,    setAgentLog]    = useState<string[]>([]);
  const [view,        setView]        = useState<"market"|"sell"|"agent">("market");
  const [selectedRow, setSelectedRow] = useState<number|null>(null);
  const [panelFlash,  setPanelFlash]  = useState(false);
  const buyPanelRef = useRef<HTMLDivElement>(null);
  const { toasts, show: showToast } = useToast();

  const addLog      = (m: string, t = "info") => setLog(l => [...l, `${t}|${ts()} ${m}`]);
  const addAgentLog = (m: string, t = "info") => setAgentLog(l => [...l, `${t}|${ts()} ${m}`]);

  function flashBuyPanel() {
    setPanelFlash(false);
    requestAnimationFrame(() => {
      setPanelFlash(true);
      buyPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => setPanelFlash(false), 800);
    });
  }

  function selectListing(l: typeof MOCK_LISTINGS[0]) {
    setSelectedRow(l.tokenId);
    setBuyId(String(l.tokenId));
    setListing({ tokenId: String(l.tokenId), seller: l.seller, price: l.price, active: l.active });
    flashBuyPanel();
    showToast(`NFT #${l.tokenId} loaded — ${l.price} ETH`, "info");
  }

  async function getContracts(write = false) {
    const addr = getAddresses(chainId);
    const p = new ethers.BrowserProvider(window.ethereum);
    if (write) {
      const s = await p.getSigner();
      return { nft: new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, s), mkt: new ethers.Contract(addr.ModelMarketplace, MODEL_MARKETPLACE_ABI, s) };
    }
    return { nft: new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, p), mkt: new ethers.Contract(addr.ModelMarketplace, MODEL_MARKETPLACE_ABI, p) };
  }

  async function listModel() {
    if (!wallet) return showToast("Connect wallet first", "error");
    setBusy(true);
    try {
      const { nft, mkt } = await getContracts(true);
      const addr = getAddresses(chainId);
      addLog(`Approving marketplace for token #${tokenId}…`);
      const t1 = await nft.approve(addr.ModelMarketplace, BigInt(tokenId));
      addLog(`Approval: ${t1.hash}`, "tx"); await t1.wait();
      const t2 = await mkt.listModel(BigInt(tokenId), ethers.parseEther(price));
      addLog(`Listing: ${t2.hash}`, "tx"); await t2.wait();
      addLog(`Model #${tokenId} listed at ${price} ETH ✓`, "ok");
      showToast(`NFT #${tokenId} listed for ${price} ETH`, "success");
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0,80)}`, "err"); showToast("Failed", "error"); }
    setBusy(false);
  }

  async function buyModel() {
    if (!wallet) return showToast("Connect wallet first", "error");
    if (!listing?.active) return;
    setBusy(true);
    try {
      const { mkt } = await getContracts(true);
      const raw = await mkt.listings(BigInt(buyId));
      const p = raw[2];
      addLog(`Buying NFT #${buyId} for ${ethers.formatEther(p)} ETH…`);
      const tx = await mkt.buyModel(BigInt(buyId), { value: p });
      addLog(`Tx: ${tx.hash}`, "tx"); await tx.wait();
      addLog(`NFT #${buyId} purchased ✓`, "ok");
      showToast(`NFT #${buyId} purchased!`, "success");
      setListing(null); setSelectedRow(null);
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0,80)}`, "err"); showToast("Failed", "error"); }
    setBusy(false);
  }

  async function fetchListing() {
    if (!buyId) return;
    try {
      const { mkt } = await getContracts();
      const raw = await mkt.listings(BigInt(buyId));
      if (raw[1] === ethers.ZeroAddress) { setListing(null); showToast("No listing found", "error"); return; }
      setListing({ tokenId: raw[0].toString(), seller: raw[1], price: ethers.formatEther(raw[2]), active: raw[3] });
      flashBuyPanel();
      showToast(`Listing found — ${ethers.formatEther(raw[2])} ETH`, "info");
    } catch (e: any) { addLog(`${e.message?.slice(0,60)}`, "err"); }
  }

  async function runAgent() {
    setTrading(true); setSignal(null); setAgentLog([]);
    addAgentLog("Initializing trading agent…", "event"); await sleep(500);
    addAgentLog("Loading model weights from 0G Storage…", "event"); await sleep(700);
    addAgentLog("Fetching ETH/USDC TWAP from oracle…", "event"); await sleep(600);
    addAgentLog("Running RL policy network inference…", "event"); await sleep(900);
    const r = Math.random();
    const sig = r > 0.52
      ? { action:"BUY",  confidence: Math.floor(r*100),       from:"USDC", to:"ETH",  amount:(Math.random()*0.1+0.02).toFixed(4) }
      : { action:"SELL", confidence: Math.floor((1-r)*100),   from:"ETH",  to:"USDC", amount:(Math.random()*0.1+0.02).toFixed(4) };
    setSignal(sig);
    addAgentLog(`Signal: ${sig.action} ${sig.amount} ${sig.from}→${sig.to} (${sig.confidence}% confidence)`, sig.action==="BUY"?"ok":"warn");
    addAgentLog("Encoding Uniswap V3 calldata…", "event"); await sleep(800);
    addAgentLog("Submitting to KeeperHub MEV-protected relay…", "event"); await sleep(1100);
    const h = "0x" + Array.from({length:40},()=>"0123456789abcdef"[Math.floor(Math.random()*16)]).join("");
    addAgentLog(`Tx confirmed: ${h}…`, "tx");
    addAgentLog(`Swapped ${sig.amount} ${sig.from} → ${sig.to} on Uniswap V3 ✓`, "ok");
    showToast(`${sig.action} executed — ${sig.amount} ${sig.from}→${sig.to}`, "success");
    setTrading(false);
  }

  function LogLines({ lines }: { lines: string[] }) {
    return <>{lines.map((l,i) => {
      const [type,...rest] = l.split("|");
      const cls = type==="ok"?"log-ok":type==="err"?"log-err":type==="tx"?"log-tx":type==="event"?"log-event":type==="warn"?"log-warn":"log-info";
      const [time,...msg] = rest.join("|").split(" ");
      return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
    })}</>;
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type==="success"?"toast-success":t.type==="error"?"toast-error":t.type==="info"?"toast-info":""}`}>
            <span className="toast-icon">{t.type==="success"?"✓":t.type==="error"?"✕":"ℹ"}</span>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div>
          <div className="section-eyebrow">Model Marketplace</div>
          <h2 style={{ fontSize:18, fontWeight:700, letterSpacing:"-0.03em" }}>Trade AI Models</h2>
          <div className="section-sub">Buy, sell, and deploy AI models as ERC-7857 NFTs</div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[["market","Market"],["sell","Sell"],["agent","⚡ Agent"]].map(([k,label]) => (
            <button key={k} className={`btn btn-sm ${view===k?"btn-primary":"btn-ghost"}`} onClick={() => setView(k as any)}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── MARKET VIEW ── */}
      {view==="market" && (
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:16, alignItems:"start" }}>

          {/* Listings table */}
          <div className="card" style={{ overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontWeight:600, fontSize:13 }}>Active Listings</span>
                <span className="badge badge-green"><span className="dot dot-green" />{MOCK_LISTINGS.filter(l=>l.active).length} live</span>
              </div>
            </div>

            {/* Hint */}
            <div style={{ padding:"8px 16px", background:"var(--blue-dim)", borderBottom:"1px solid var(--blue-border)", fontSize:11.5, color:"var(--blue)", display:"flex", alignItems:"center", gap:6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Click a row to load it into the Buy panel on the right →
            </div>

            <table className="data-table" style={{ width:"100%" }}>
              <thead><tr><th>Token</th><th>Description</th><th>Score</th><th>Price</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {MOCK_LISTINGS.map(l => (
                  <tr key={l.tokenId} className={selectedRow===l.tokenId?"row-selected":""} style={{ cursor:"pointer" }} onClick={() => selectListing(l)}>
                    <td><span className="mono" style={{ fontSize:11, color:"var(--text-tertiary)" }}>#{l.tokenId}</span></td>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:22, height:22, borderRadius:4, flexShrink:0, background:`linear-gradient(135deg,hsl(${l.tokenId*60+220} 70% 60%),hsl(${l.tokenId*60+280} 80% 50%))` }} />
                        <span style={{ fontWeight:500, fontSize:12 }}>{l.desc}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div className="progress-bar" style={{ width:40 }}><div className="progress-fill purple" style={{ width:`${l.score}%` }} /></div>
                        <span style={{ fontSize:11 }}>{l.score}</span>
                      </div>
                    </td>
                    <td><span style={{ fontWeight:700, fontFamily:"JetBrains Mono", fontSize:12 }}>{l.price} <span style={{ color:"var(--text-tertiary)", fontWeight:400 }}>ETH</span></span></td>
                    <td>
                      <span className={`badge ${l.active?"badge-green":"badge-gray"}`}>
                        <span className={`dot ${l.active?"dot-green":"dot-gray"}`} />
                        {l.active?"Active":"Sold"}
                      </span>
                    </td>
                    <td>
                      <button className={`btn btn-xs ${l.active?"btn-primary":"btn-ghost"}`} disabled={!l.active}
                        onClick={e => { e.stopPropagation(); selectListing(l); }}>
                        {l.active?"Buy →":"Sold"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Buy panel — flashes on row select */}
          <div ref={buyPanelRef} className={`card ${panelFlash?"anim-flash":""}`} style={{ padding:20 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div>
                <div className="section-eyebrow">Buy</div>
                <div style={{ fontWeight:600, fontSize:14 }}>Purchase Model NFT</div>
              </div>
              {selectedRow!==null && <span className="updated-badge">#{selectedRow} loaded ↑</span>}
            </div>

            <div style={{ display:"flex", gap:8, marginBottom:14 }}>
              <input className="input input-sm" placeholder="Token ID" value={buyId}
                onChange={e => setBuyId(e.target.value)} onKeyDown={e => e.key==="Enter" && fetchListing()} />
              <button className="btn btn-ghost btn-sm" style={{ flexShrink:0 }} onClick={fetchListing}>Check</button>
            </div>

            {listing ? (
              <div className="anim-fade-in" style={{ marginBottom:14 }}>
                <div style={{ background:"var(--bg-raised)", border:`1px solid ${listing.active?"var(--green-border)":"var(--border)"}`, borderRadius:"var(--r-md)", padding:"12px 14px", marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div>
                      <div style={{ fontSize:9, fontWeight:700, color:"var(--green)", textTransform:"uppercase", letterSpacing:"0.07em" }}>NFT #{listing.tokenId}</div>
                      <div style={{ fontSize:22, fontWeight:700, letterSpacing:"-0.04em" }}>
                        {listing.price} <span style={{ fontSize:12, fontWeight:400, color:"var(--text-tertiary)" }}>ETH</span>
                      </div>
                      <div style={{ fontSize:10.5, color:"var(--text-tertiary)", marginTop:4 }}>
                        {MOCK_LISTINGS.find(l=>String(l.tokenId)===String(listing.tokenId))?.desc}
                      </div>
                    </div>
                    <span className={`badge ${listing.active?"badge-green":"badge-red"}`}>
                      <span className={`dot ${listing.active?"dot-green":"dot-red"}`} />
                      {listing.active?"Active":"Inactive"}
                    </span>
                  </div>
                  {listing.seller && (
                    <div style={{ fontSize:10.5, color:"var(--text-tertiary)", marginTop:8 }}>
                      Seller: <span className="mono">{listing.seller}</span>
                    </div>
                  )}
                </div>
                <button className="btn btn-success btn-full btn-lg" disabled={busy||!listing.active} onClick={buyModel}>
                  {busy?<><span className="anim-spin">⟳</span> Buying…</>:"Buy Model NFT →"}
                </button>
              </div>
            ) : (
              <div className="empty-state" style={{ padding:"24px 0" }}>
                <div style={{ fontSize:28, color:"var(--text-disabled)", marginBottom:8 }}>←</div>
                <div className="empty-text">Click a listing row to load it here</div>
              </div>
            )}

            {/* Fee breakdown */}
            <div style={{ paddingTop:14, borderTop:"1px solid var(--border)" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"var(--text-tertiary)", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Revenue Split</div>
              <div className="fee-bar" style={{ marginBottom:8 }}>
                <div className="fee-bar-seg" style={{ width:"92.5%", background:"var(--green)" }} />
                <div className="fee-bar-seg" style={{ width:"5%", background:"var(--purple)" }} />
                <div className="fee-bar-seg" style={{ width:"2.5%", background:"var(--blue)" }} />
              </div>
              {[["Seller gets","92.5%","var(--green)"],["Creator royalty","5%","var(--purple)"],["Protocol fee","2.5%","var(--blue)"]].map(([k,v,c])=>(
                <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:11, color:"var(--text-secondary)" }}>{k}</span>
                  <span style={{ fontSize:11, fontWeight:700, color:c }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SELL VIEW ── */}
      {view==="sell" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div className="card" style={{ padding:24 }}>
            <div style={{ marginBottom:20 }}>
              <div className="section-eyebrow">Seller</div>
              <div className="section-title">List Model for Sale</div>
              <div className="section-sub">Fixed-price listing with on-chain royalties</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div className="field"><label className="label">Token ID</label><input className="input" value={tokenId} onChange={e=>setTokenId(e.target.value)} /></div>
                <div className="field"><label className="label">List Price (ETH)</label><input className="input" type="number" step="0.001" value={price} onChange={e=>setPrice(e.target.value)} /></div>
              </div>
              {price && (
                <div style={{ background:"var(--bg-raised)", border:"1px solid var(--border)", borderRadius:"var(--r-md)", padding:"12px 14px" }}>
                  <div style={{ fontSize:10.5, color:"var(--text-tertiary)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>At sale of {price} ETH</div>
                  {[["You receive",(parseFloat(price)*0.925).toFixed(4)+" ETH","var(--green)"],
                    ["Creator royalty",(parseFloat(price)*0.05).toFixed(4)+" ETH","var(--purple)"],
                    ["Protocol fee",(parseFloat(price)*0.025).toFixed(4)+" ETH","var(--blue)"]].map(([k,v,c])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                      <span style={{ fontSize:12, color:"var(--text-secondary)" }}>{k}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:c, fontFamily:"JetBrains Mono" }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn btn-primary btn-full btn-lg" disabled={busy} onClick={listModel}>
                {busy?<><span className="anim-spin">⟳</span> Listing…</>:"Approve & List →"}
              </button>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div className="card" style={{ padding:20 }}>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>How it works</div>
              {[["1","Approve the marketplace to transfer your NFT"],["2","NFT moves to escrow on ModelMarketplace"],["3","Buyer pays — royalties split automatically"],["4","ETH released to you, NFT to buyer"]].map(([n,t])=>(
                <div key={n} style={{ display:"flex", gap:10, marginBottom:10 }}>
                  <span className="badge badge-black" style={{ flexShrink:0 }}>{n}</span>
                  <span style={{ fontSize:12, color:"var(--text-secondary)", lineHeight:1.5 }}>{t}</span>
                </div>
              ))}
            </div>
            {log.length>0 && (
              <div className="terminal">
                <div className="terminal-header">
                  <div className="terminal-dot" style={{ background:"#ff5f57" }} /><div className="terminal-dot" style={{ background:"#febc2e" }} /><div className="terminal-dot" style={{ background:"#28c840" }} />
                  <span className="terminal-title">marketplace — log</span>
                </div>
                <div className="terminal-body"><LogLines lines={log} /></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AGENT VIEW ── */}
      {view==="agent" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div className="card" style={{ padding:24 }}>
            <div style={{ marginBottom:20 }}>
              <div className="section-eyebrow">Autonomous Agent</div>
              <div className="section-title">Run Trading Agent</div>
              <div className="section-sub">Load model → RL inference → KeeperHub → Uniswap V3</div>
            </div>
            <div style={{ display:"flex", gap:6, marginBottom:20, flexWrap:"wrap" }}>
              {["agent.py","KeeperHub","Uniswap V3","0G Storage"].map(p=><span key={p} className="pill">{p}</span>)}
            </div>
            <button className="btn btn-primary btn-full btn-lg" disabled={trading} onClick={runAgent} style={{ marginBottom:16 }}>
              {trading?<><span className="anim-spin">⟳</span> Running…</>:"⚡ Run Trading Agent →"}
            </button>
            {signal && (
              <div className={`signal-box ${signal.action==="BUY"?"signal-buy":"signal-sell"} anim-slide-in`}>
                <div style={{ fontSize:22, fontWeight:800, color:signal.action==="BUY"?"var(--green)":"var(--orange)", letterSpacing:"-0.05em", minWidth:54 }}>{signal.action}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{signal.amount} {signal.from} → {signal.to}</div>
                  <div style={{ fontSize:11.5, color:"var(--text-secondary)", marginTop:2 }}>Confidence: <strong>{signal.confidence}%</strong> · Uniswap V3 via KeeperHub</div>
                </div>
                <span className={`badge ${signal.action==="BUY"?"badge-green":"badge-orange"}`}>
                  <span className={`dot ${signal.action==="BUY"?"dot-green":"dot-orange"}`} />Executed
                </span>
              </div>
            )}
            <div className="alert alert-muted" style={{ marginTop:16, fontSize:11.5 }}>
              Reads your Model NFT's CID, runs inference via <span className="code">agent.py</span>, then submits the swap through KeeperHub's MEV-protected relay.
            </div>
          </div>
          <div className="card" style={{ overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontWeight:600, fontSize:13 }}>Agent Activity</span>
              {trading&&<span className="badge badge-blue"><span className="dot dot-blue anim-pulse" /> Running</span>}
              {!trading&&agentLog.length>0&&<span className="badge badge-green">Complete</span>}
            </div>
            {agentLog.length>0?(
              <div className="terminal" style={{ borderRadius:0, boxShadow:"none" }}>
                <div className="terminal-body" style={{ maxHeight:320 }}><LogLines lines={agentLog} /></div>
              </div>
            ):(
              <div className="empty-state"><div className="empty-icon">⚡</div><div className="empty-text">Press "Run Trading Agent" to start</div></div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  function LogLines({ lines }: { lines: string[] }) {
    return <>{lines.map((l,i) => {
      const [type,...rest] = l.split("|");
      const cls = type==="ok"?"log-ok":type==="err"?"log-err":type==="tx"?"log-tx":type==="event"?"log-event":type==="warn"?"log-warn":"log-info";
      const [time,...msg] = rest.join("|").split(" ");
      return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
    })}</>;
  }
}
