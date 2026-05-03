"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import { getAddresses, GPU_MARKETPLACE_ABI } from "../lib/contracts";
import type { FlowState } from "../page";

interface Props { wallet: string | null; chainId: number; flow: FlowState; }
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

// Demo rows shown only when wallet is NOT connected (pre-wallet preview).
// Once a wallet is connected we fetch the real list from chain.
const MOCK_GPUS = [
  { id: 0, name: "RTX 4090",  vram: "24GB",  price: "0.0012", util: 87, available: false, metadata: "ipfs://demo-rtx4090"  },
  { id: 1, name: "A100 80G",  vram: "80GB",  price: "0.0035", util: 0,  available: true,  metadata: "ipfs://demo-a100"     },
  { id: 2, name: "RTX 3090",  vram: "24GB",  price: "0.0008", util: 45, available: true,  metadata: "ipfs://demo-rtx3090"  },
  { id: 3, name: "H100 NVL",  vram: "94GB",  price: "0.0060", util: 0,  available: true,  metadata: "ipfs://demo-h100"     },
  { id: 4, name: "RTX 4080S", vram: "16GB",  price: "0.0009", util: 100,available: false, metadata: "ipfs://demo-rtx4080s" },
];

interface ChainGpu { id: number; name: string; vram: string; price: string; util: number; available: boolean; metadata: string; }

// Best-effort metadata parser. listGPU stores a freeform string; we try
// to extract a model name and VRAM from common patterns. Falls back to id.
function parseGpuMeta(metadata: string, id: number): { name: string; vram: string } {
  const m = metadata.match(/RTX[\s-]?\d+\w*|A100[\s\w]*|H100[\s\w]*|H200[\s\w]*|L40[\s\w]*|MI300[\s\w]*/i);
  const v = metadata.match(/(\d+)\s?GB/i);
  return {
    name: m ? m[0].replace(/\s+/g, " ").trim() : `GPU #${id}`,
    vram: v ? `${v[1]}GB` : "—",
  };
}

// ── Toast helper hook ──
function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const show = useCallback((msg: string, type = "default") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);
  return { toasts, show };
}

export default function GPUPanel({ wallet, chainId, flow }: Props) {
  const [metadata,    setMetadata]    = useState("ipfs://QmGpuSpecs-RTX4090-24GB");
  const [price,       setPrice]       = useState("0.001");
  const [gpuType,     setGpuType]     = useState("RTX 4090");
  const [vram,        setVram]        = useState("24");
  const [gpuId,       setGpuId]       = useState("");
  const [gpu,         setGpu]         = useState<any>(null);
  const [log,         setLog]         = useState<string[]>([]);
  const [busy,        setBusy]        = useState(false);
  const [totalGPUs,   setTotalGPUs]   = useState<number | null>(null);
  const [chainGpus,   setChainGpus]   = useState<ChainGpu[] | null>(null); // null = not loaded yet
  const [activeView,  setActiveView]  = useState<"list" | "register">("list");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [panelFlash,  setPanelFlash]  = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const { toasts, show: showToast } = useToast();

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  // Flash the detail panel and scroll it into view
  function flashDetail() {
    setPanelFlash(false);
    requestAnimationFrame(() => {
      setPanelFlash(true);
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => setPanelFlash(false), 800);
    });
  }

  async function getContract(write = false) {
    const addr = getAddresses(chainId);
    const p = new ethers.BrowserProvider(window.ethereum);
    if (write) { const s = await p.getSigner(); return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, s); }
    return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, p);
  }

  async function listGPU() {
    if (!wallet) return showToast("Connect your wallet first", "error");
    setBusy(true);
    try {
      const c = await getContract(true);
      addLog(`Listing GPU [${gpuType} ${vram}GB] — ${price} ETH/hr`);
      const tx = await c.listGPU(metadata, ethers.parseEther(price));
      addLog(`Tx: ${tx.hash}`, "tx");
      const rc = await tx.wait();
      const ev = rc.logs.find((l: any) => l.fragment?.name === "GPUListed");
      const id = ev ? ev.args[0].toString() : "?";
      addLog(`GPU listed — gpuId = ${id}`, "ok");
      showToast(`GPU listed as #${id}`, "success");
      setGpuId(id);
      setActiveView("list");
      fetchStats();
      fetchChainGpus();
    } catch (e: any) {
      addLog(`${e.reason ?? e.message?.slice(0, 100)}`, "err");
      showToast("Transaction failed", "error");
    }
    setBusy(false);
  }

  async function selectGPU(id: number) {
    setSelectedRow(id);
    setGpuId(String(id));
    flow.setLastGpuId(String(id));
    flashDetail();
    if (!window.ethereum) {
      const mock = MOCK_GPUS.find(g => g.id === id);
      if (mock) {
        setGpu({ provider: "0xMockProvider…", price: mock.price, metadata: mock.metadata, available: mock.available });
        showToast(`GPU #${id} — ${mock.name} selected`, "info");
      }
      return;
    }
    try {
      const c = await getContract();
      const g = await c.getGPU(BigInt(id));
      const provider = g[0] as string;
      if (!provider || provider === ethers.ZeroAddress) {
        setGpu(null);
        showToast(`GPU #${id} not listed on-chain — click + List GPU first`, "error");
        return;
      }
      setGpu({ provider, price: ethers.formatEther(g[1]), metadata: g[2], available: g[3] });
      showToast(`GPU #${id} loaded`, "info");
    } catch {
      setGpu(null);
      showToast(`GPU #${id} not found on-chain`, "error");
    }
  }

  async function fetchGPU() {
    if (!gpuId) return;
    if (!window.ethereum) return showToast("Connect a wallet to fetch on-chain data", "error");
    try {
      const c = await getContract();
      const g = await c.getGPU(BigInt(gpuId));
      const provider = g[0] as string;
      if (!provider || provider === ethers.ZeroAddress) {
        setGpu(null);
        showToast(`GPU #${gpuId} not listed on-chain`, "error");
        return;
      }
      setGpu({ provider, price: ethers.formatEther(g[1]), metadata: g[2], available: g[3] });
      flashDetail();
      showToast(`GPU #${gpuId} fetched`, "info");
    } catch (e: any) {
      setGpu(null);
      showToast(`GPU #${gpuId} not found`, "error");
      addLog(`${e.message?.slice(0, 80)}`, "err");
    }
  }

  async function fetchStats() {
    try {
      const c = await getContract();
      const n = await c.nextGpuId();
      setTotalGPUs(Number(n));
    } catch {}
  }

  // Pull every listed GPU from chain. Called on mount and after a successful list.
  const fetchChainGpus = useCallback(async () => {
    if (!window.ethereum) { setChainGpus(null); return; }
    try {
      const c = await getContract();
      const next: bigint = await c.nextGpuId();
      const total = Number(next);
      const out: ChainGpu[] = [];
      for (let i = 0; i < total; i++) {
        try {
          const g = await c.getGPU(BigInt(i));
          const provider = g[0] as string;
          if (!provider || provider === ethers.ZeroAddress) continue;
          const meta = parseGpuMeta(g[2], i);
          out.push({
            id: i,
            name: meta.name,
            vram: meta.vram,
            price: ethers.formatEther(g[1]),
            util: 0,
            available: g[3] as boolean,
            metadata: g[2] as string,
          });
        } catch { /* skip */ }
      }
      setChainGpus(out);
      setTotalGPUs(total);
    } catch (e) {
      setChainGpus([]);
    }
  }, [chainId]);

  useEffect(() => { fetchChainGpus(); }, [fetchChainGpus]);

  // Defer window-dependent decisions to after first client render to avoid
  // hydration mismatch (server has no `window`, so it would always render MOCK).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const hasEthereum = mounted && typeof window !== "undefined" && !!window.ethereum;
  const visibleGpus: ChainGpu[] = chainGpus !== null
    ? chainGpus
    : (hasEthereum ? [] : MOCK_GPUS);
  const usingMock = chainGpus === null && !hasEthereum;

  const addr = getAddresses(chainId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Toast container ── */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type === "success" ? "toast-success" : t.type === "error" ? "toast-error" : t.type === "info" ? "toast-info" : ""}`}>
            <span className="toast-icon">{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
            {t.msg}
          </div>
        ))}
      </div>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="section-eyebrow">GPU Market</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em" }}>Available Compute</h2>
          <div className="section-sub">Click a row to inspect — Rent available GPUs</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className={`btn btn-sm ${activeView === "list" ? "btn-primary" : "btn-ghost"}`} onClick={() => setActiveView("list")}>
            Browse GPUs
          </button>
          <button className={`btn btn-sm ${activeView === "register" ? "btn-primary" : "btn-ghost"}`} onClick={() => setActiveView("register")}>
            + List GPU
          </button>
        </div>
      </div>

      {activeView === "list" ? (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "start" }}>

          {/* GPU Table */}
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Listed GPUs</span>
                <span className="badge badge-gray">{visibleGpus.length} total</span>
                {usingMock && <span className="badge badge-orange" style={{ fontSize: 10 }}>demo data</span>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <span className="badge badge-green"><span className="dot dot-green" />{visibleGpus.filter(g => g.available).length} available</span>
                <span className="badge badge-gray">{visibleGpus.filter(g => !g.available).length} busy</span>
              </div>
            </div>

            {/* Hint banner */}
            <div style={{
              padding: "8px 16px",
              background: "var(--blue-dim)",
              borderBottom: "1px solid var(--blue-border)",
              fontSize: 11.5,
              color: "var(--blue)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Click any row to inspect its details in the panel on the right →
            </div>

            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Model</th>
                  <th>VRAM</th>
                  <th>Utilization</th>
                  <th>Price/hr</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleGpus.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                      <div style={{ fontSize: 13, marginBottom: 8 }}>
                        No GPUs listed on-chain yet.
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setActiveView("register")}
                      >
                        + List the first GPU
                      </button>
                    </td>
                  </tr>
                )}
                {visibleGpus.map(g => (
                  <tr
                    key={g.id}
                    className={selectedRow === g.id ? "row-selected" : ""}
                    style={{ cursor: "pointer" }}
                    onClick={() => selectGPU(g.id)}
                  >
                    <td><span className="mono" style={{ color: "var(--text-tertiary)", fontSize: 11 }}>#{g.id}</span></td>
                    <td><span style={{ fontWeight: 600 }}>{g.name}</span></td>
                    <td><span className="badge badge-gray">{g.vram}</span></td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="progress-bar" style={{ width: 60 }}>
                          <div className={`progress-fill ${g.util > 80 ? "purple" : g.util > 40 ? "blue" : ""}`} style={{ width: `${g.util}%` }} />
                        </div>
                        <span style={{ fontSize: 11, color: "var(--text-tertiary)", minWidth: 28 }}>{g.util}%</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: "var(--green)", fontFamily: "JetBrains Mono", fontSize: 12 }}>
                        {g.price} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>ETH</span>
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${g.available ? "badge-green" : "badge-gray"}`}>
                        <span className={`dot ${g.available ? "dot-green" : "dot-gray"}`} />
                        {g.available ? "Available" : "Busy"}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`btn btn-xs ${g.available ? "btn-primary" : "btn-ghost"}`}
                        disabled={!g.available}
                        onClick={e => { e.stopPropagation(); selectGPU(g.id); }}
                      >
                        {g.available ? "Select →" : "Busy"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* GPU Detail panel */}
          <div
            ref={detailRef}
            className={`card ${panelFlash ? "anim-flash" : ""}`}
            style={{ padding: 20, transition: "border-color 0.3s, box-shadow 0.3s" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div className="section-eyebrow">Inspector</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>GPU Details</div>
              </div>
              {selectedRow !== null && (
                <span className="updated-badge">#{selectedRow} selected</span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input className="input input-sm" placeholder="GPU ID" value={gpuId}
                onChange={e => setGpuId(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchGPU()} />
              <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={fetchGPU}>Fetch</button>
            </div>

            {gpu ? (
              <div className="anim-fade-in">
                {/* GPU name banner */}
                {selectedRow !== null && (() => {
                  const m = visibleGpus.find(g => g.id === selectedRow);
                  return m ? (
                    <div style={{
                      background: "var(--bg-raised)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--r-md)",
                      padding: "10px 14px",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{m.vram} VRAM</div>
                      </div>
                      <span className={`badge ${m.available ? "badge-green" : "badge-gray"}`}>
                        <span className={`dot ${m.available ? "dot-green" : "dot-gray"}`} />
                        {m.available ? "Available" : "Busy"}
                      </span>
                    </div>
                  ) : null;
                })()}

                <div className="data-row">
                  <span className="data-label">Provider</span>
                  <button className="hash-pill">{gpu.provider.slice(0, 8)}…{gpu.provider.slice(-5)}</button>
                </div>
                <div className="data-row">
                  <span className="data-label">Price</span>
                  <span className="data-value" style={{ color: "var(--green)", fontWeight: 700 }}>
                    {gpu.price} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>ETH/hr</span>
                  </span>
                </div>
                <div className="data-row">
                  <span className="data-label">URI</span>
                  <span className="hash-pill truncate" style={{ maxWidth: 130, fontSize: 10 }}>
                    {gpu.metadata.slice(0, 22)}…
                  </span>
                </div>

                {/* Go to Jobs CTA */}
                {gpu.available && (
                  <button
                    className="alert alert-success"
                    onClick={() => flow.setTab("jobs")}
                    style={{
                      marginTop: 14, display: "flex", alignItems: "center",
                      justifyContent: "space-between", width: "100%",
                      cursor: "pointer", border: "none", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 11.5 }}>Ready to rent — continue to Compute Jobs →</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>
                )}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: "24px 0" }}>
                <div style={{ fontSize: 28, color: "var(--text-disabled)", marginBottom: 8 }}>←</div>
                <div className="empty-text">Click a GPU row to inspect it</div>
              </div>
            )}

            {/* Contract info */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Contract</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>GPUMarketplace</span>
                <button className="hash-pill" onClick={() => { navigator.clipboard?.writeText(addr.GPUMarketplace); showToast("Address copied", "success"); }} data-tooltip="Copy">
                  {addr.GPUMarketplace.slice(0, 8)}…{addr.GPUMarketplace.slice(-6)}
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

      ) : (
        /* ── Register form ── */
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ marginBottom: 20 }}>
              <div className="section-eyebrow">Provider Registration</div>
              <div className="section-title">List GPU for Rent</div>
              <div className="section-sub">Register your hardware as an on-chain compute provider</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label className="label">GPU Model</label>
                  <select className="input" value={gpuType} onChange={e => setGpuType(e.target.value)}>
                    {["RTX 4090","RTX 3090","A100 80G","H100 NVL","RTX 4080S","Other"].map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">VRAM (GB)</label>
                  <input className="input" type="number" value={vram} onChange={e => setVram(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <label className="label">Specs URI (IPFS / HTTPS)</label>
                <input className="input input-mono" value={metadata} onChange={e => setMetadata(e.target.value)} placeholder="ipfs://Qm…" />
              </div>

              <div className="field">
                <label className="label">Price Per Hour</label>
                <div style={{ position: "relative" }}>
                  <input className="input" type="number" step="0.0001" value={price}
                    onChange={e => setPrice(e.target.value)} style={{ paddingRight: 60 }} />
                  <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600, letterSpacing: "0.04em" }}>ETH/hr</span>
                </div>
              </div>

              <button className="btn btn-primary btn-full btn-lg" disabled={busy} onClick={listGPU}>
                {busy ? <><span className="anim-spin">⟳</span> Submitting…</> : "List GPU on Network →"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Estimated Earnings</div>
              {[["1 hour", 1],["8 hours", 8],["24 hours", 24],["1 week", 168]].map(([p, h]) => (
                <div className="data-row" key={p as string}>
                  <span className="data-label">{p}</span>
                  <span className="data-value" style={{ color: "var(--green)", fontWeight: 700, fontFamily: "JetBrains Mono", fontSize: 12 }}>
                    {(parseFloat(price) * (h as number)).toFixed(4)} ETH
                  </span>
                </div>
              ))}
            </div>
            <div className="alert alert-muted" style={{ fontSize: 12 }}>
              Payment is held in escrow on <span className="code">GPUMarketplace</span> and released to you when the job completes.
            </div>
          </div>
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="terminal">
          <div className="terminal-header">
            <div className="terminal-dot" style={{ background: "#ff5f57" }} />
            <div className="terminal-dot" style={{ background: "#febc2e" }} />
            <div className="terminal-dot" style={{ background: "#28c840" }} />
            <span className="terminal-title">gpu-marketplace — activity log</span>
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
  );
}
