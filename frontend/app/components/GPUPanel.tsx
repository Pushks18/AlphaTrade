"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { getAddresses, GPU_MARKETPLACE_ABI } from "../lib/contracts";

interface Props { wallet: string | null; chainId: number; }

function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

export default function GPUPanel({ wallet, chainId }: Props) {
  const [metadata, setMetadata]   = useState("ipfs://QmGpuSpecs-RTX4090-24GB");
  const [price,    setPrice]      = useState("0.001");
  const [gpuId,    setGpuId]      = useState("0");
  const [gpu,      setGpu]        = useState<any>(null);
  const [log,      setLog]        = useState<string[]>([]);
  const [busy,     setBusy]       = useState(false);
  const [totalGPUs, setTotalGPUs] = useState<number|null>(null);

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  async function getSigner() {
    const p = new ethers.BrowserProvider(window.ethereum);
    return p.getSigner();
  }
  async function getContract(write = false) {
    const addr = getAddresses(chainId);
    if (write) {
      const s = await getSigner();
      return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, s);
    }
    const p = new ethers.BrowserProvider(window.ethereum);
    return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, p);
  }

  async function listGPU() {
    if (!wallet) return alert("Connect your wallet first");
    setBusy(true);
    try {
      const c = await getContract(true);
      const priceWei = ethers.parseEther(price);
      addLog(`Listing GPU — metadata: ${metadata.slice(0,40)}…`);
      addLog(`Price: ${price} ETH/hr`, "info");
      const tx = await c.listGPU(metadata, priceWei);
      addLog(`Tx submitted: ${tx.hash}`, "tx");
      const rc = await tx.wait();
      const ev = rc.logs.find((l: any) => l.fragment?.name === "GPUListed");
      const id  = ev ? ev.args[0].toString() : "?";
      addLog(`✅ GPU listed successfully! gpuId = ${id}`, "ok");
      setGpuId(id);
      fetchStats();
    } catch(e: any) { addLog(`❌ ${e.reason ?? e.message?.slice(0,100)}`, "err"); }
    setBusy(false);
  }

  async function fetchGPU() {
    if (!window.ethereum) return alert("Connect wallet first");
    try {
      const c = await getContract();
      const g = await c.getGPU(BigInt(gpuId));
      setGpu({ provider: g[0], price: ethers.formatEther(g[1]), metadata: g[2], available: g[3] });
      addLog(`Fetched GPU #${gpuId}`, "ok");
    } catch(e: any) { addLog(`❌ ${e.message?.slice(0,80)}`, "err"); }
  }

  async function fetchStats() {
    try {
      const c = await getContract();
      const n = await c.nextGpuId();
      setTotalGPUs(Number(n));
    } catch {}
  }

  const addr = getAddresses(chainId);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {/* List GPU */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">🖥 List GPU for Rent</div>
          <div className="section-sub">Register your hardware as a compute provider</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label className="label">Hardware Specs URI</label>
            <input className="input input-mono" value={metadata} onChange={e=>setMetadata(e.target.value)} placeholder="ipfs://Qm... or https://..." />
          </div>
          <div className="field">
            <label className="label">Price Per Hour (ETH)</label>
            <div style={{ position: "relative" }}>
              <input className="input" type="number" step="0.0001" value={price} onChange={e=>setPrice(e.target.value)}
                style={{ paddingRight: 60 }} />
              <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>ETH/hr</span>
            </div>
          </div>
          <button className="btn btn-blue btn-full" disabled={busy} onClick={listGPU}>
            {busy ? <><span className="anim-spin">⟳</span> Submitting…</> : "List GPU →"}
          </button>

          {/* Contract address strip */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>GPUMarketplace</span>
            <span className="addr" onClick={() => navigator.clipboard?.writeText(addr.GPUMarketplace)}>
              {addr.GPUMarketplace.slice(0,10)}…{addr.GPUMarketplace.slice(-6)}
            </span>
          </div>
        </div>
      </div>

      {/* GPU Lookup */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">🔍 GPU Registry Lookup</div>
          <div className="section-sub">Inspect any listed GPU by its ID</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <input className="input" placeholder="GPU ID (e.g. 0)" value={gpuId}
            onChange={e=>setGpuId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&fetchGPU()} />
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={fetchGPU}>Fetch</button>
        </div>

        {gpu ? (
          <div>
            <div className="row"><span className="row-label">Provider</span><span className="row-value mono" style={{ fontSize: 12, color: "var(--cyan)" }}>{gpu.provider.slice(0,14)}…</span></div>
            <div className="row"><span className="row-label">Price</span><span className="row-value"><span className="gradient-green" style={{ fontWeight: 700 }}>{gpu.price} ETH</span><span style={{ color: "var(--text-3)", fontSize: 12 }}>/hr</span></span></div>
            <div className="row"><span className="row-label">Status</span><span className={`badge ${gpu.available?"badge-green":"badge-red"}`}>{gpu.available?"● Available":"● Busy"}</span></div>
            <div className="row"><span className="row-label">Metadata</span><span className="row-value mono" style={{ fontSize: 11, color: "var(--text-2)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{gpu.metadata}</span></div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-3)", fontSize: 13 }}>
            Enter a GPU ID and click Fetch
          </div>
        )}

        {totalGPUs !== null && (
          <div className="info-box" style={{ marginTop: 16 }}>
            <strong style={{ color: "var(--blue-light)" }}>{totalGPUs}</strong> GPU{totalGPUs !== 1 ? "s" : ""} listed on this network
          </div>
        )}
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={{ gridColumn: "1/-1" }}>
          <div className="terminal">
            {log.map((l, i) => {
              const [type, ...rest] = l.split("|");
              const cls = type === "ok" ? "log-ok" : type === "err" ? "log-err" : type === "tx" ? "log-tx" : "log-info";
              const [time, ...msg] = rest.join("|").split(" ");
              return (
                <div key={i} className="log-line">
                  <span className="log-ts">{time}</span>
                  <span className={cls}>{msg.join(" ")}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
