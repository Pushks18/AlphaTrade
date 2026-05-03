"use client";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { getAddresses, MODEL_NFT_ABI, PERFORMANCE_ORACLE_ABI } from "../lib/contracts";
import { trainModel, startProve, awaitProve, pingShim, uploadTo0G } from "../lib/zkmlApi";
import type { FlowState } from "../page";

interface Props { wallet: string | null; chainId: number; flow: FlowState; }
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

type NftRow = { id: number; desc: string; score: number; job: number; creator: string; owner: string };

// Pseudo-CID generator (until real IPFS / 0G upload is wired in).
// Produces an ipfs:// URI that looks like a real CIDv0 (Qm + 44 base58-ish chars)
// and is unique per call so each mint has distinct provenance pointers.
function fakeCID(prefix: string) {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = "";
  for (let i = 0; i < 44; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return `ipfs://Qm${s}_${prefix}`;
}

export default function NFTPanel({ wallet, chainId, flow }: Props) {
  const [jobId,    setJobId]    = useState("0");

  // Auto-prefill jobId when arriving from the Compute Jobs tab.
  useEffect(() => {
    if (flow.lastJobId && flow.lastJobId !== jobId) {
      setJobId(flow.lastJobId);
      setView("mint");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.lastJobId]);
  const [modelCID, setModelCID] = useState(() => fakeCID("model"));
  const [proofCID, setProofCID] = useState(() => fakeCID("proof"));
  const [desc,     setDesc]     = useState("");
  const [tokenId,  setTokenId]  = useState("");
  const [nft,      setNft]      = useState<any>(null);
  const [log,      setLog]      = useState<string[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [view,     setView]     = useState<"gallery" | "mint">("gallery");
  const [chainNfts, setChainNfts] = useState<NftRow[] | null>(null);
  const [filter,    setFilter]   = useState<"all" | "mine">("all");

  const myCount = chainNfts?.filter(n => wallet && n.owner.toLowerCase() === wallet.toLowerCase()).length ?? 0;
  const visibleNfts = (chainNfts ?? []).filter(n =>
    filter === "all" || (wallet && n.owner.toLowerCase() === wallet.toLowerCase())
  );

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  const fetchChainNfts = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    try {
      const c = await getContract();
      const next: bigint = await c.nextTokenId();
      const rows: NftRow[] = [];
      for (let id = 1n; id < next; id++) {
        try {
          const [creatorAddr, ownerAddr, score, jid, uri] = await Promise.all([
            c.creator(id), c.ownerOf(id), c.performanceScore(id), c.jobIdOfToken(id), c.tokenURI(id),
          ]);
          let descStr = `Model #${id}`;
          try {
            if (uri.startsWith("data:")) {
              const meta = JSON.parse(atob(uri.split(",")[1]));
              descStr = meta.description ?? meta.name ?? descStr;
            } else if (uri && uri.length < 200) {
              descStr = uri;
            }
          } catch {}
          const s = Number(score);
          rows.push({
            id: Number(id),
            desc: descStr,
            score: s > 100 ? Math.round(s / 100) : s,
            job: Number(jid),
            creator: creatorAddr,
            owner: ownerAddr,
          });
        } catch {}
      }
      setChainNfts(rows);
    } catch (e: any) {
      addLog(`gallery fetch failed: ${e.shortMessage ?? e.message?.slice(0,60)}`, "err");
      setChainNfts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  useEffect(() => { fetchChainNfts(); }, [fetchChainNfts, wallet]);

  async function getContract(write = false) {
    const addr = getAddresses(chainId);
    const p = new ethers.BrowserProvider(window.ethereum);
    if (write) { const s = await p.getSigner(); return new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, s); }
    return new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, p);
  }

  async function mintModel() {
    if (!wallet) return alert("Connect your wallet first");
    if (!desc.trim()) return alert("Please enter a model description");
    setBusy(true);
    try {
      const c = await getContract(true);
      addLog(`Minting Model iNFT for completed job #${jobId}…`);
      addLog(`modelCID: ${modelCID}`, "tx");
      addLog(`proofCID: ${proofCID}`, "tx");
      // Derive a deterministic weights hash from the modelCID for the demo.
      // In production, this is the SHA3 of the actual model weights produced by train.py.
      const weightsHash = ethers.keccak256(ethers.toUtf8Bytes(modelCID));
      // Send a small creator stake (0.01 ETH) along with the mint.
      const stake = ethers.parseEther("0.01");
      const tx = await c.mintModel(BigInt(jobId), modelCID, proofCID, desc, weightsHash, { value: stake });
      addLog(`Tx: ${tx.hash}`, "tx");
      const rc = await tx.wait();
      const ev = rc.logs.find((l: any) => l.fragment?.name === "ModelMinted");
      const tid = ev ? ev.args[0].toString() : "?";
      addLog(`Model NFT minted — tokenId = ${tid} (ERC-7857)`, "ok");
      setTokenId(tid);
      flow.setLastTokenId(tid);
      setView("gallery");
      fetchNFT(tid);
      fetchChainNfts();
      // Reset form so next mint produces unique CIDs
      setModelCID(fakeCID("model"));
      setProofCID(fakeCID("proof"));
      setDesc("");
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 100)}`, "err"); }
    setBusy(false);
  }

  async function trainAndProve() {
    if (!jobId || jobId.trim() === "") { alert("Enter the Job ID first"); return; }
    setBusy(true);
    try {
      addLog("Pinging zkML shim at localhost:8001…");
      const ok = await pingShim();
      if (!ok) {
        addLog("zkML shim not running. Start it: cd backend && python3 -m uvicorn server:app --port 8001", "err");
        setBusy(false);
        return;
      }
      addLog(`▶ train.py --job-id ${jobId} (this takes ~30s on M4)…`);
      const t = await trainModel({ job_id: parseInt(jobId), epochs: 20 });
      addLog(`✓ Trained. weightsHash = ${(t.weights_hash ?? "").slice(0, 18)}…`, "ok");
      addLog(`▶ prove.py — generating EZKL proof (60–120s on M4)…`);
      const job = await startProve({ weights_dir: t.weights_dir, epoch: 1 });
      addLog(`Prove job started: ${job.job_id}`);
      const final = await awaitProve(job.job_id, s => addLog(`… prove ${s.status} (${Math.round(s.elapsed ?? 0)}s)`));
      if (final.status !== "done") {
        addLog(`Prove failed: ${JSON.stringify(final.error).slice(0, 200)}`, "err");
        setBusy(false);
        return;
      }
      addLog(`✓ Proof generated in ${Math.round(final.elapsed ?? 0)}s`, "ok");
      const modelPath = `${t.weights_dir}/model.onnx`;
      const proofPath = `${final.proof_dir}/proof.json`;

      // ── Upload both artifacts to 0G Storage ─────────────────────────
      addLog(`▶ Uploading model.onnx to 0G Storage…`);
      const modelUp = await uploadTo0G(modelPath);
      addLog(`  ${modelUp.mode === "live" ? "✓ on-chain commit" : "stub"} — rootHash ${modelUp.rootHash.slice(0,18)}…`, "ok");
      if (modelUp.txHash) addLog(`  0G tx: ${modelUp.txHash.slice(0,12)}…`, "tx");
      if (modelUp.notice) addLog(`  ⓘ ${modelUp.notice.slice(0,80)}`);

      addLog(`▶ Uploading proof.json to 0G Storage…`);
      const proofUp = await uploadTo0G(proofPath);
      addLog(`  ${proofUp.mode === "live" ? "✓ on-chain commit" : "stub"} — rootHash ${proofUp.rootHash.slice(0,18)}…`, "ok");
      if (proofUp.txHash) addLog(`  0G tx: ${proofUp.txHash.slice(0,12)}…`, "tx");

      // Use 0G rootHash as the CID — the form value contains the canonical
      // 0G identifier (rootHash) that the auditor and frontend look up.
      setModelCID(`0g://${modelUp.rootHash}`);
      setProofCID(`0g://${proofUp.rootHash}`);
      addLog(`modelCID = 0g://${modelUp.rootHash.slice(0,18)}…`, "ok");
      addLog(`proofCID = 0g://${proofUp.rootHash.slice(0,18)}…`, "ok");
    } catch (e: any) {
      addLog(`train+prove error: ${e.message?.slice(0, 200)}`, "err");
    }
    setBusy(false);
  }

  async function submitDemoAudit() {
    if (!wallet || !tokenId) return;
    setBusy(true);
    try {
      const addr = getAddresses(chainId);
      if (!addr.PerformanceOracle || addr.PerformanceOracle === ethers.ZeroAddress) {
        addLog("PerformanceOracle not configured for this chain", "err");
        setBusy(false);
        return;
      }
      const p = new ethers.BrowserProvider(window.ethereum);
      const s = await p.getSigner();
      const oracle = new ethers.Contract(addr.PerformanceOracle, PERFORMANCE_ORACLE_ABI, s);
      // Sharpe in bps. Random in [4000, 9500] = 40–95 score after /100.
      const sharpeBps = 4000 + Math.floor(Math.random() * 5500);
      const epoch = Math.floor(Date.now() / 1000);
      addLog(`Submitting demo audit for token #${tokenId} — Sharpe ${(sharpeBps/100).toFixed(0)}/100…`);
      const tx = await oracle.submitAuditDemo(BigInt(tokenId), BigInt(sharpeBps), BigInt(epoch));
      addLog(`Tx: ${tx.hash}`, "tx");
      await tx.wait();
      addLog(`Audit accepted — score updated ✓`, "ok");
      fetchNFT(tokenId);
      fetchChainNfts();
    } catch (e: any) {
      addLog(`audit failed: ${e.reason ?? e.shortMessage ?? e.message?.slice(0, 80)}`, "err");
    }
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
          {view === "gallery" && wallet && (
            <>
              <button
                className={`btn btn-sm ${filter === "all" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setFilter("all")}
              >
                All ({chainNfts?.length ?? 0})
              </button>
              <button
                className={`btn btn-sm ${filter === "mine" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setFilter("mine")}
                title="Show only NFTs owned by the connected wallet"
              >
                Mine ({myCount})
              </button>
              <span style={{ width: 1, background: "var(--border)", margin: "0 4px" }} />
            </>
          )}
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
              {visibleNfts.length === 0 && (
                <div style={{ gridColumn: "1 / -1", padding: "24px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 12, border: "1px dashed var(--border)", borderRadius: "var(--r-md)" }}>
                  {chainNfts === null
                    ? "Loading minted NFTs…"
                    : filter === "mine"
                      ? "You don't own any model NFTs yet. Complete a job and mint one — or buy one in the Trade tab."
                      : "No NFTs minted yet — complete a job and mint one."}
                </div>
              )}
              {visibleNfts.map(n => (
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "var(--purple)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      Model #{n.id}
                    </span>
                    {wallet && n.owner.toLowerCase() === wallet.toLowerCase() && (
                      <span className="badge badge-green" style={{ fontSize: 9, padding: "2px 6px" }}>YOURS</span>
                    )}
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
                  {nft.score !== "0" && (() => {
                    const raw = parseInt(nft.score);
                    const display = raw > 100 ? Math.round(raw / 100) : raw;
                    return (
                      <>
                        <div className="data-row">
                          <span className="data-label">Performance</span>
                          <span className="data-value" style={{ color: display > 80 ? "var(--green)" : "var(--text-primary)" }}>
                            {display}/100
                          </span>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <div className="progress-bar">
                            <div className="progress-fill purple" style={{ width: `${display}%` }} />
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Submit demo audit → updates performanceScore on-chain */}
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={submitDemoAudit}
                    style={{ width: "100%", marginTop: 12 }}
                    title="Demo: writes a Sharpe score directly via oracle.submitAuditDemo (admin-only). Skip in production — use real EZKL audit."
                  >
                    {busy ? "Submitting…" : "↗ Submit Audit (demo)"}
                  </button>

                  {/* Continue → Trade */}
                  <button
                    className="alert alert-success"
                    onClick={() => flow.setTab("market")}
                    style={{
                      marginTop: 14, display: "flex", alignItems: "center",
                      justifyContent: "space-between", width: "100%",
                      cursor: "pointer", border: "none", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 11.5 }}>List or sell this NFT — continue to Trade →</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>
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
                <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. LSTM momentum strategy v2" />
              </div>

              <button
                className="btn btn-ghost btn-full"
                disabled={busy}
                onClick={trainAndProve}
                title="Calls backend FastAPI shim → train.py then prove.py. Replaces fake CIDs with real model + EZKL proof artifact paths. ~2 minutes on M4."
              >
                {busy ? <><span className="anim-spin">⟳</span> Training + proving…</> : "▶ Train + Prove (real)"}
              </button>

              <button className="btn btn-accent btn-full btn-lg" disabled={busy} onClick={mintModel}>
                {busy ? <><span className="anim-spin">⟳</span> Minting…</> : "Mint Model NFT →"}
              </button>

              <div className="alert alert-purple" style={{ fontSize: 11.5 }}>
                Mint right is consumed atomically — one NFT per completed job. Duplicates are rejected by the contract.
                Click "Train + Prove" first to generate real artifacts (requires <code style={{ fontSize: 10 }}>uvicorn server:app --port 8001</code> running in <code style={{ fontSize: 10 }}>backend/</code>).
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
