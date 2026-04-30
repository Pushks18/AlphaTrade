"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { getAddresses, GPU_MARKETPLACE_ABI } from "../lib/contracts";

interface Props { wallet: string | null; chainId: number; }

const STATUS_CFG: Record<number, { label: string; badge: string; dot: string }> = {
  0: { label: "Created",   badge: "badge-orange", dot: "dot-orange" },
  1: { label: "Running",   badge: "badge-blue",   dot: "dot-blue"   },
  2: { label: "Completed", badge: "badge-green",  dot: "dot-green"  },
  3: { label: "Cancelled", badge: "badge-red",    dot: "dot-red"    },
};

function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

export default function JobPanel({ wallet, chainId }: Props) {
  const [gpuId,    setGpuId]    = useState("0");
  const [duration, setDuration] = useState("2");
  const [jobId,    setJobId]    = useState("");
  const [job,      setJob]      = useState<any>(null);
  const [log,      setLog]      = useState<string[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [phase,    setPhase]    = useState<"idle" | "renting" | "training" | "done">("idle");
  const [priceEst, setPriceEst] = useState<string | null>(null);

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  async function getContract(write = false) {
    const addr = getAddresses(chainId);
    const p = new ethers.BrowserProvider(window.ethereum);
    if (write) { const s = await p.getSigner(); return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, s); }
    return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, p);
  }

  async function estimateCost() {
    if (!window.ethereum) return;
    try {
      const c = await getContract();
      const g = await c.getGPU(BigInt(gpuId));
      const total = g[1] * BigInt(duration);
      setPriceEst(ethers.formatEther(total));
    } catch { setPriceEst(null); }
  }

  async function rentGPU() {
    if (!wallet) return alert("Connect your wallet first");
    setBusy(true); setPhase("renting");
    try {
      const c = await getContract(true);
      const g = await c.getGPU(BigInt(gpuId));
      if (g[0] === ethers.ZeroAddress) { addLog("GPU not found", "err"); setBusy(false); return; }
      const totalCost = g[1] * BigInt(duration);
      addLog(`Renting GPU #${gpuId} for ${duration}h — ${ethers.formatEther(totalCost)} ETH escrowed`);
      const tx = await c.rentGPU(BigInt(gpuId), BigInt(duration), { value: totalCost });
      addLog(`Tx: ${tx.hash}`, "tx");
      const rc  = await tx.wait();
      const ev  = rc.logs.find((l: any) => l.fragment?.name === "JobCreated");
      const jid = ev ? ev.args[0].toString() : "?";
      addLog(`Job created — jobId = ${jid}`, "ok");
      setJobId(jid);
      setPhase("training");
      addLog(`Backend listener detected JobCreated event`, "event");
      addLog(`Launching train.py on price data…`, "event");
      addLog(`Uploading weights to 0G Storage…`, "event");
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 100)}`, "err"); setPhase("idle"); }
    setBusy(false);
  }

  async function completeJob() {
    if (!wallet) return alert("Connect your wallet first");
    if (!jobId) return alert("Enter a job ID first");
    setBusy(true);
    try {
      const c = await getContract(true);
      addLog(`Completing job #${jobId} — releasing escrow to provider…`);
      const tx = await c.completeJob(BigInt(jobId));
      addLog(`Tx: ${tx.hash}`, "tx");
      await tx.wait();
      addLog(`Escrow released ✓`, "ok");
      addLog(`mintModel() is now callable with CIDs from 0G Storage`, "event");
      setPhase("done");
      fetchJob();
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 100)}`, "err"); }
    setBusy(false);
  }

  async function cancelJob() {
    if (!wallet) return alert("Connect your wallet first");
    if (!jobId) return alert("Enter a job ID first");
    setBusy(true);
    try {
      const c = await getContract(true);
      addLog(`Cancelling job #${jobId}…`);
      const tx = await c.cancelJob(BigInt(jobId));
      addLog(`Tx: ${tx.hash}`, "tx");
      await tx.wait();
      addLog(`Job cancelled — escrow refunded`, "ok");
      setPhase("idle");
      fetchJob();
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 100)}`, "err"); }
    setBusy(false);
  }

  async function fetchJob() {
    if (!jobId) return;
    try {
      const c   = await getContract();
      const j   = await c.getJob(BigInt(jobId));
      const ok  = await c.jobCompleted(BigInt(jobId));
      const minted = await c.modelMinted(BigInt(jobId));
      setJob({
        renter: j[0], gpuId: j[1].toString(), duration: j[2].toString(),
        cost: ethers.formatEther(j[3]), status: Number(j[4]), completed: ok, minted,
      });
      addLog(`Job #${jobId} fetched`, "ok");
    } catch (e: any) { addLog(`${e.message?.slice(0, 60)}`, "err"); }
  }

  const cfg = job ? STATUS_CFG[job.status] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Header ── */}
      <div>
        <div className="section-eyebrow">Compute Jobs</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em" }}>Rent GPU Compute</h2>
        <div className="section-sub">Lock payment in escrow and dispatch a training job to a GPU provider</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* ── Create Job ── */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <div className="section-eyebrow">New Job</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Create Compute Job</div>
            </div>
            {phase !== "idle" && (
              <span className={`badge ${phase === "renting" ? "badge-orange" : phase === "training" ? "badge-blue" : "badge-green"}`}>
                <span className={`dot ${phase === "renting" ? "dot-orange" : phase === "training" ? "dot-blue" : "dot-green"}`} />
                {phase === "renting" ? "Broadcasting…" : phase === "training" ? "Training" : "Complete"}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label className="label">GPU ID</label>
                <input className="input" value={gpuId}
                  onChange={e => { setGpuId(e.target.value); setPriceEst(null); }}
                  onBlur={estimateCost} placeholder="0" />
              </div>
              <div className="field">
                <label className="label">Duration (hours)</label>
                <input className="input" type="number" min="1" value={duration}
                  onChange={e => { setDuration(e.target.value); setPriceEst(null); }}
                  onBlur={estimateCost} />
              </div>
            </div>

            {/* Cost estimate */}
            <div style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Estimated cost (escrowed)</span>
              <div style={{ textAlign: "right" }}>
                {priceEst ? (
                  <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.03em", fontFamily: "JetBrains Mono" }}>
                    {priceEst} <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 400 }}>ETH</span>
                  </span>
                ) : (
                  <button className="btn btn-xs btn-muted" onClick={estimateCost}>
                    Calculate
                  </button>
                )}
              </div>
            </div>

            <button className="btn btn-primary btn-full btn-lg" disabled={busy} onClick={rentGPU}>
              {busy && phase === "renting"
                ? <><span className="anim-spin">⟳</span> Creating Job…</>
                : "Rent GPU & Start Job →"}
            </button>

            <div className="alert alert-muted" style={{ fontSize: 11.5 }}>
              After renting, the backend detects the <span className="code">JobCreated</span> event
              and starts <span className="code" style={{ color: "var(--purple)" }}>train.py</span> automatically on price data from 0G.
            </div>
          </div>
        </div>

        {/* ── Job Inspector ── */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 18 }}>
            <div className="section-eyebrow">Inspector</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Job Status & Actions</div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input className="input" placeholder="Job ID" value={jobId}
              onChange={e => setJobId(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchJob()} />
            <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={fetchJob}>Fetch</button>
          </div>

          {job ? (
            <div>
              {/* Status header */}
              <div style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                padding: "12px 14px",
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Job #{jobId}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, letterSpacing: "-0.03em" }}>
                    {job.cost} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-tertiary)" }}>ETH escrowed</span>
                  </div>
                </div>
                {cfg && (
                  <span className={`badge ${cfg.badge}`}>
                    <span className={`dot ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                )}
              </div>

              <div className="data-row">
                <span className="data-label">Renter</span>
                <button className="hash-pill">{job.renter.slice(0, 9)}…{job.renter.slice(-5)}</button>
              </div>
              <div className="data-row">
                <span className="data-label">GPU #</span>
                <span className="data-value">{job.gpuId}</span>
              </div>
              <div className="data-row">
                <span className="data-label">Duration</span>
                <span className="data-value">{job.duration} hrs</span>
              </div>
              <div className="data-row">
                <span className="data-label">NFT Minted</span>
                <span className={`badge ${job.minted ? "badge-purple" : "badge-gray"}`}>
                  {job.minted ? "✓ Minted" : "Not yet"}
                </span>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: "24px 0" }}>
              <div className="empty-icon" style={{ fontSize: 24 }}>⬚</div>
              <div className="empty-text">Enter a Job ID and press Fetch</div>
            </div>
          )}

          {/* Actions */}
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-success btn-full" disabled={busy || (job?.status === 2)} onClick={completeJob}>
              {busy ? <><span className="anim-spin">⟳</span> Processing…</> : "✓ Complete Job (Provider)"}
            </button>
            <button className="btn btn-danger btn-sm btn-full" disabled={busy || !jobId || (job?.status === 3)} onClick={cancelJob}>
              Cancel Job
            </button>
          </div>
        </div>
      </div>

      {/* ── Activity Log ── */}
      {log.length > 0 && (
        <div className="terminal">
          <div className="terminal-header">
            <div className="terminal-dot" style={{ background: "#ff5f57" }} />
            <div className="terminal-dot" style={{ background: "#febc2e" }} />
            <div className="terminal-dot" style={{ background: "#28c840" }} />
            <span className="terminal-title">job-pipeline — activity log</span>
          </div>
          <div className="terminal-body">
            {log.map((l, i) => {
              const [type, ...rest] = l.split("|");
              const cls = type === "ok" ? "log-ok" : type === "err" ? "log-err" : type === "tx" ? "log-tx" : type === "event" ? "log-event" : "log-info";
              const [time, ...msg] = rest.join("|").split(" ");
              return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
