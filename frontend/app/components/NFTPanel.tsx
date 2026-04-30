"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { getAddresses, MODEL_NFT_ABI } from "../lib/contracts";

interface Props { wallet: string | null; chainId: number; }
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

// Mock minted NFTs — would be fetched from events
const MOCK_NFTS = [
  { id: 1, desc: "Trend-following RL predictor v1", score: 82, job: 0, creator: "0xaBc1…3f22" },
  { id: 2, desc: "LSTM momentum strategy v2",       score: 71, job: 1, creator: "0x9fD2…a811" },
  { id: 3, desc: "Volatility arbitrage model",      score: 91, job: 2, creator: "0xaBc1…3f22" },
];

export default function NFTPanel({ wallet, chainId }: Props) {
  const [jobId,    setJobId]    = useState("0");
  const [modelCID, setModelCID] = useState("ipfs://QmModelWeightsExample");
  const [proofCID, setProofCID] = useState("ipfs://QmZkProofExample");
  const [desc,     setDesc]     = useState("Trend-following RL predictor v1");
  const [tokenId,  setTokenId]  = useState("");
  const [nft,      setNft]      = useState<any>(null);
  const [log,      setLog]      = useState<string[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [view,     setView]     = useState<"gallery" | "mint">("gallery");

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  async function getContract(write = false) {
    const addr = getAddresses(chainId);
    const p = new ethers.BrowserProvider(window.ethereum);
    if (write) { const s = await p.getSigner(); return new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, s); }
    return new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, p);
  }

  async function mintModel() {
    if (!wallet) return alert("Connect your wallet first");
    setBusy(true);
    try {
      const c = await getContract(true);
      addLog(`Minting Model iNFT for completed job #${jobId}…`);
      addLog(`modelCID: ${modelCID}`, "tx");
      addLog(`proofCID: ${proofCID}`, "tx");
      const tx = await c.mintModel(BigInt(jobId), modelCID, proofCID, desc);
      addLog(`Tx: ${tx.hash}`, "tx");
      const rc = await tx.wait();
      const ev = rc.logs.find((l: any) => l.fragment?.name === "ModelMinted");
      const tid = ev ? ev.args[0].toString() : "?";
      addLog(`Model NFT minted — tokenId = ${tid} (ERC-7857)`, "ok");
      setTokenId(tid);
      setView("gallery");
      fetchNFT(tid);
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 100)}`, "err"); }
    setBusy(false);
  }

  async function fetchNFT(tid?: string) {
    const id = tid ?? tokenId;
    if (!id) return;
    try {
      const c = await getContract();
      const [owner, creatorAddr, score, jid, uri] = await Promise.all([
        c.ownerOf(BigInt(id)), c.creator(BigInt(id)), c.performanceScore(BigInt(id)),
        c.jobIdOfToken(BigInt(id)), c.tokenURI(BigInt(id)),
      ]);
      let meta: any = {};
      try { meta = JSON.parse(atob(uri.split(",")[1])); } catch {}
      setNft({ owner, creator: creatorAddr, score: score.toString(), jobId: jid.toString(), meta });
      addLog(`Fetched NFT #${id}`, "ok");
    } catch (e: any) { addLog(`${e.message?.slice(0, 60)}`, "err"); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="section-eyebrow">ERC-7857 iNFTs</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em" }}>Model NFTs</h2>
          <div className="section-sub">AI model ownership, verified on-chain with zkML proofs via 0G Storage</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn btn-sm ${view === "gallery" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("gallery")}>
            Gallery
          </button>
          <button className={`btn btn-sm ${view === "mint" ? "btn-accent" : "btn-ghost"}`} onClick={() => setView("mint")}>
            + Mint NFT
          </button>
        </div>
      </div>

      {view === "gallery" ? (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>

          {/* ── NFT Grid ── */}
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
              {MOCK_NFTS.map(n => (
                <div
                  key={n.id}
                  className="card"
                  style={{ padding: 16, cursor: "pointer", transition: "box-shadow 0.15s", border: tokenId === String(n.id) ? "1.5px solid var(--purple)" : undefined }}
                  onClick={() => { setTokenId(String(n.id)); fetchNFT(String(n.id)); }}
                >
                  {/* NFT visual — gradient placeholder */}
                  <div style={{
                    height: 90, borderRadius: "var(--r-md)", marginBottom: 10,
                    background: `linear-gradient(135deg, hsl(${n.id * 60 + 220} 70% 60%), hsl(${n.id * 60 + 280} 80% 50%))`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, color: "rgba(255,255,255,0.5)",
                  }}>
                    ◈
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--purple)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                    Model #{n.id}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 6, lineHeight: 1.3 }}>
                    {n.desc}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span className="badge badge-purple" style={{ fontSize: 10 }}>ERC-7857</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: n.score > 80 ? "var(--green)" : "var(--text-secondary)" }}>
                      {n.score}/100
                    </span>
                  </div>
                </div>
              ))}

              {/* "Mint new" card */}
              <div
                className="card"
                style={{
                  padding: 16, cursor: "pointer", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", minHeight: 160,
                  border: "1.5px dashed var(--border)", boxShadow: "none",
                  background: "var(--bg-raised)",
                }}
                onClick={() => setView("mint")}
              >
                <div style={{ fontSize: 28, color: "var(--text-disabled)", marginBottom: 8 }}>+</div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>Mint new NFT</div>
              </div>
            </div>
          </div>

          {/* ── NFT Inspector ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ marginBottom: 14 }}>
                <div className="section-eyebrow">Inspector</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>NFT Details</div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input className="input input-sm" placeholder="Token ID" value={tokenId}
                  onChange={e => setTokenId(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchNFT()} />
                <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => fetchNFT()}>Fetch</button>
              </div>

              {nft ? (
                <div>
                  {/* Visual card */}
                  <div style={{
                    height: 70, borderRadius: "var(--r-md)",
                    background: `linear-gradient(135deg, hsl(${parseInt(tokenId || "1") * 60 + 220} 70% 60%), hsl(${parseInt(tokenId || "1") * 60 + 280} 80% 50%))`,
                    marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, color: "rgba(255,255,255,0.5)",
                  }}>◈</div>
                  {nft.meta.description && (
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 12, letterSpacing: "-0.01em" }}>
                      {nft.meta.description}
                    </div>
                  )}
                  <div className="data-row">
                    <span className="data-label">Owner</span>
                    <button className="hash-pill">{nft.owner.slice(0, 8)}…{nft.owner.slice(-5)}</button>
                  </div>
                  <div className="data-row">
                    <span className="data-label">Creator</span>
                    <button className="hash-pill">{nft.creator.slice(0, 8)}…{nft.creator.slice(-5)}</button>
                  </div>
                  <div className="data-row">
                    <span className="data-label">Job ID</span>
                    <span className="data-value">#{nft.jobId}</span>
                  </div>
                  {nft.score !== "0" && (
                    <div className="data-row">
                      <span className="data-label">Performance</span>
                      <span className="data-value" style={{ color: parseInt(nft.score) > 80 ? "var(--green)" : "var(--text-primary)" }}>
                        {nft.score}/100
                      </span>
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <div className="progress-bar">
                      <div className="progress-fill purple" style={{ width: `${nft.score}%` }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state" style={{ padding: "16px 0" }}>
                  <div className="empty-icon" style={{ fontSize: 20 }}>◇</div>
                  <div className="empty-text">Click a card or enter Token ID</div>
                </div>
              )}
            </div>

            {log.length > 0 && (
              <div className="terminal">
                <div className="terminal-header">
                  <div className="terminal-dot" style={{ background: "#ff5f57" }} />
                  <div className="terminal-dot" style={{ background: "#febc2e" }} />
                  <div className="terminal-dot" style={{ background: "#28c840" }} />
                  <span className="terminal-title">model-nft — log</span>
                </div>
                <div className="terminal-body" style={{ maxHeight: 130 }}>
                  {log.map((l, i) => {
                    const [type, ...rest] = l.split("|");
                    const cls = type === "ok" ? "log-ok" : type === "err" ? "log-err" : type === "tx" ? "log-tx" : "log-info";
                    const [time, ...msg] = rest.join("|").split(" ");
                    return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

      ) : (
        /* ── Mint Form ── */
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ marginBottom: 20 }}>
              <div className="section-eyebrow">ERC-7857</div>
              <div className="section-title">Mint Model iNFT</div>
              <div className="section-sub">Tokenize your trained AI model with zkML verification</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <div className="field">
                <label className="label">Job ID (must be completed)</label>
                <input className="input" value={jobId} onChange={e => setJobId(e.target.value)} placeholder="0" />
              </div>
              <div className="field">
                <label className="label">Model Weights CID — 0G Storage</label>
                <input className="input input-mono" value={modelCID} onChange={e => setModelCID(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">zkML Proof CID — 0G Storage</label>
                <input className="input input-mono" value={proofCID} onChange={e => setProofCID(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Model Description</label>
                <input className="input" value={desc} onChange={e => setDesc(e.target.value)} />
              </div>

              <button className="btn btn-accent btn-full btn-lg" disabled={busy} onClick={mintModel}>
                {busy ? <><span className="anim-spin">⟳</span> Minting…</> : "Mint Model NFT →"}
              </button>

              <div className="alert alert-purple" style={{ fontSize: 11.5 }}>
                Mint right is consumed atomically — one NFT per completed job. Duplicates are rejected by the contract.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>What gets minted?</div>
              {[
                ["Token Standard",  "ERC-7857 (AI iNFT)"],
                ["Metadata",        "Base64 encoded on-chain"],
                ["Model weights",   "IPFS/0G Storage CID"],
                ["zkML Proof",      "Verified off-chain"],
                ["Creator royalty", "5% on secondary sales"],
              ].map(([k, v]) => (
                <div className="data-row" key={k}>
                  <span className="data-label">{k}</span>
                  <span className="data-value" style={{ fontWeight: 500, fontSize: 12 }}>{v}</span>
                </div>
              ))}
            </div>

            {log.length > 0 && (
              <div className="terminal">
                <div className="terminal-header">
                  <div className="terminal-dot" style={{ background: "#ff5f57" }} />
                  <div className="terminal-dot" style={{ background: "#febc2e" }} />
                  <div className="terminal-dot" style={{ background: "#28c840" }} />
                  <span className="terminal-title">model-nft — log</span>
                </div>
                <div className="terminal-body">
                  {log.map((l, i) => {
                    const [type, ...rest] = l.split("|");
                    const cls = type === "ok" ? "log-ok" : type === "err" ? "log-err" : type === "tx" ? "log-tx" : "log-info";
                    const [time, ...msg] = rest.join("|").split(" ");
                    return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
