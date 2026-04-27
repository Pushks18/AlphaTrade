"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { getAddresses, MODEL_NFT_ABI } from "../lib/contracts";

interface Props { wallet: string | null; chainId: number; }
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

export default function NFTPanel({ wallet, chainId }: Props) {
  const [jobId,    setJobId]    = useState("0");
  const [modelCID, setModelCID] = useState("ipfs://QmModelWeightsExample");
  const [proofCID, setProofCID] = useState("ipfs://QmZkProofExample");
  const [desc,     setDesc]     = useState("Trend-following RL predictor v1");
  const [tokenId,  setTokenId]  = useState("");
  const [nft,      setNft]      = useState<any>(null);
  const [log,      setLog]      = useState<string[]>([]);
  const [busy,     setBusy]     = useState(false);

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
      addLog(`Minting Model iNFT for job #${jobId}…`);
      addLog(`modelCID: ${modelCID}`, "tx");
      addLog(`proofCID: ${proofCID}`, "tx");
      const tx = await c.mintModel(BigInt(jobId), modelCID, proofCID, desc);
      addLog(`Tx: ${tx.hash}`, "tx");
      const rc  = await tx.wait();
      const ev  = rc.logs.find((l: any) => l.fragment?.name === "ModelMinted");
      const tid = ev ? ev.args[0].toString() : "?";
      addLog(`✅ Model NFT minted! tokenId = ${tid} (ERC-7857 iNFT)`, "ok");
      setTokenId(tid);
      fetchNFT(tid);
    } catch(e: any) { addLog(`❌ ${e.reason ?? e.message?.slice(0,100)}`, "err"); }
    setBusy(false);
  }

  async function fetchNFT(tid?: string) {
    const id = tid ?? tokenId;
    if (!id) return;
    try {
      const c = await getContract();
      const [owner, creatorAddr, score, jid, uri] = await Promise.all([
        c.ownerOf(BigInt(id)),
        c.creator(BigInt(id)),
        c.performanceScore(BigInt(id)),
        c.jobIdOfToken(BigInt(id)),
        c.tokenURI(BigInt(id)),
      ]);
      let meta: any = {};
      try { const b64 = uri.split(",")[1]; meta = JSON.parse(atob(b64)); } catch {}
      setNft({ owner, creator: creatorAddr, score: score.toString(), jobId: jid.toString(), meta });
      addLog(`Fetched NFT #${id}`, "ok");
    } catch(e: any) { addLog(`❌ ${e.message?.slice(0,60)}`, "err"); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {/* Mint */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">🧠 Mint Model iNFT</div>
          <div className="section-sub">ERC-7857 — AI model ownership, trustlessly onchain</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label className="label">Job ID (must be completed)</label>
            <input className="input" value={jobId} onChange={e=>setJobId(e.target.value)} placeholder="0" />
          </div>
          <div className="field">
            <label className="label">Model Weights CID — 0G Storage</label>
            <input className="input input-mono" value={modelCID} onChange={e=>setModelCID(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">zkML Proof CID — 0G Storage</label>
            <input className="input input-mono" value={proofCID} onChange={e=>setProofCID(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Model Description</label>
            <input className="input" value={desc} onChange={e=>setDesc(e.target.value)} />
          </div>
          <button className="btn btn-purple btn-full" disabled={busy} onClick={mintModel}>
            {busy ? <><span className="anim-spin">⟳</span> Minting…</> : "Mint Model NFT →"}
          </button>

          <div className="info-box purple">
            🔐 Mint right is pulled atomically from GPUMarketplace — only one NFT per job, no duplicates possible.
          </div>
        </div>
      </div>

      {/* Inspect */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">🔍 NFT Inspector</div>
          <div className="section-sub">Decode inline base64 metadata onchain</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <input className="input" placeholder="Token ID" value={tokenId}
            onChange={e=>setTokenId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&fetchNFT()} />
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={()=>fetchNFT()}>Fetch</button>
        </div>

        {nft ? (
          <div>
            {/* NFT Card visual */}
            <div style={{ background: "linear-gradient(135deg,rgba(139,92,246,.15),rgba(34,211,238,.1))", border: "1px solid rgba(167,139,250,.3)", borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--purple)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>ComputeX Model #{tokenId}</div>
              <div style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 10px", color: "var(--text-1)" }}>{nft.meta.description || "AI Model NFT"}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className="badge badge-purple">iNFT ERC-7857</span>
                <span className="badge badge-cyan">0G Storage</span>
                {nft.score !== "0" && <span className="badge badge-gold">Score: {nft.score}</span>}
              </div>
            </div>
            <div className="row"><span className="row-label">Owner</span><span className="mono" style={{ fontSize: 12, color: "var(--cyan)" }}>{nft.owner.slice(0,14)}…</span></div>
            <div className="row"><span className="row-label">Creator</span><span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{nft.creator.slice(0,14)}…</span></div>
            <div className="row"><span className="row-label">Job ID</span><span className="row-value">#{nft.jobId}</span></div>
            {nft.meta.modelCID && <div className="row"><span className="row-label">modelCID</span><span className="mono" style={{ fontSize: 11, color: "var(--text-2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{nft.meta.modelCID}</span></div>}
            {nft.meta.proofCID && <div className="row"><span className="row-label">proofCID</span><span className="mono" style={{ fontSize: 11, color: "var(--text-2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{nft.meta.proofCID}</span></div>}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-3)", fontSize: 13 }}>Enter a token ID to inspect</div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="terminal" style={{ marginTop: 14 }}>
            {log.map((l, i) => {
              const [type, ...rest] = l.split("|");
              const cls = type==="ok"?"log-ok":type==="err"?"log-err":type==="tx"?"log-tx":"log-info";
              const [time, ...msg] = rest.join("|").split(" ");
              return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
