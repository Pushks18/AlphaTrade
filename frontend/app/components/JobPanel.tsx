"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { getAddresses, GPU_MARKETPLACE_ABI } from "../lib/contracts";

interface Props { wallet: string | null; chainId: number; }

const STATUS_LABELS = ["Created","Running","Completed","Cancelled"];
const STATUS_BADGE  = ["badge-orange","badge-blue","badge-green","badge-red"];
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

export default function JobPanel({ wallet, chainId }: Props) {
  const [gpuId,    setGpuId]    = useState("0");
  const [duration, setDuration] = useState("2");
  const [jobId,    setJobId]    = useState("");
  const [job,      setJob]      = useState<any>(null);
  const [log,      setLog]      = useState<string[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [phase,    setPhase]    = useState<"idle"|"renting"|"training"|"done">("idle");

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  async function getContract(write = false) {
    const addr = getAddresses(chainId);
    const p = new ethers.BrowserProvider(window.ethereum);
    if (write) { const s = await p.getSigner(); return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, s); }
    return new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, p);
  }

  async function rentGPU() {
    if (!wallet) return alert("Connect your wallet first");
    setBusy(true); setPhase("renting");
    try {
      const c = await getContract(true);
      const g = await c.getGPU(BigInt(gpuId));
      if (g[0] === ethers.ZeroAddress) { addLog("❌ GPU not found", "err"); setBusy(false); return; }
      const totalCost = g[1] * BigInt(duration);
      addLog(`Renting GPU #${gpuId} for ${duration}h`);
      addLog(`Cost: ${ethers.formatEther(totalCost)} ETH (escrowed in contract)`);
      const tx = await c.rentGPU(BigInt(gpuId), BigInt(duration), { value: totalCost });
      addLog(`Tx: ${tx.hash}`, "tx");
      const rc  = await tx.wait();
      const ev  = rc.logs.find((l: any) => l.fragment?.name === "JobCreated");
      const jid = ev ? ev.args[0].toString() : "?";
      addLog(`✅ Job created! jobId = ${jid}`, "ok");
      setJobId(jid);
      setPhase("training");
      addLog(`🎯 Backend listener detected JobCreated event`, "event");
      addLog(`🐍 Launching train.py — training model on price data…`, "event");
      addLog(`📡 Uploading weights + zkML proof to 0G Storage…`, "event");
    } catch(e: any) { addLog(`❌ ${e.reason ?? e.message?.slice(0,100)}`, "err"); setPhase("idle"); }
    setBusy(false);
  }

  async function completeJob() {
    if (!wallet) return alert("Connect your wallet first");
    setBusy(true);
    try {
      const c = await getContract(true);
      addLog(`Completing job #${jobId} — releasing escrow to provider…`);
      const tx = await c.completeJob(BigInt(jobId));
      addLog(`Tx: ${tx.hash}`, "tx");
      await tx.wait();
      addLog(`✅ Escrow released to provider`, "ok");
      addLog(`🔔 mintModel() can now be called with CIDs from 0G Storage`, "event");
      setPhase("done");
    } catch(e: any) { addLog(`❌ ${e.reason ?? e.message?.slice(0,100)}`, "err"); }
    setBusy(false);
  }

  async function fetchJob() {
    if (!jobId) return;
    try {
      const c   = await getContract();
      const j   = await c.getJob(BigInt(jobId));
      const ok  = await c.jobCompleted(BigInt(jobId));
      const minted = await c.modelMinted(BigInt(jobId));
      setJob({ renter: j[0], gpuId: j[1].toString(), duration: j[2].toString(), cost: ethers.formatEther(j[3]), status: Number(j[4]), completed: ok, minted });
      addLog(`Fetched job #${jobId}`, "ok");
    } catch(e: any) { addLog(`❌ ${e.message?.slice(0,60)}`, "err"); }
  }

  const phaseColor = phase === "training" ? "var(--orange)" : phase === "done" ? "var(--green)" : "var(--text-3)";
  const phaseLabel = { idle: "", renting: "Renting…", training: "⚙️ Training in progress", done: "✅ Ready to mint NFT" }[phase];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {/* Rent */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">⚙️ Rent GPU Compute</div>
          <div className="section-sub">Lock payment in escrow and dispatch a training job</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="label">GPU ID</label>
              <input className="input" value={gpuId} onChange={e=>setGpuId(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label className="label">Duration (hrs)</label>
              <input className="input" type="number" min="1" value={duration} onChange={e=>setDuration(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-blue btn-full" disabled={busy} onClick={rentGPU}>
            {busy && phase === "renting" ? <><span className="anim-spin">⟳</span> Renting…</> : "Rent GPU & Start Job →"}
          </button>
          {phaseLabel && (
            <div style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: phaseColor }}>{phaseLabel}</div>
          )}
          <div className="info-box">
            💡 After renting, your backend listener detects the{" "}
            <code style={{ color: "var(--cyan)", fontFamily: "Geist Mono, monospace" }}>JobCreated</code>{" "}
            event and automatically starts <code style={{ color: "var(--purple)" }}>train.py</code>.
          </div>
        </div>
      </div>

      {/* Status + Complete */}
      <div className="card" style={{ padding: 26 }}>
        <div style={{ marginBottom: 22 }}>
          <div className="section-title">📋 Job Inspector</div>
          <div className="section-sub">Check escrow status and settle completed jobs</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input className="input" placeholder="Job ID" value={jobId}
            onChange={e=>setJobId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&fetchJob()} />
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={fetchJob}>Fetch</button>
        </div>

        {job ? (
          <div style={{ marginBottom: 16 }}>
            <div className="row"><span className="row-label">Status</span><span className={`badge ${STATUS_BADGE[job.status]}`}>● {STATUS_LABELS[job.status]}</span></div>
            <div className="row"><span className="row-label">GPU</span><span className="row-value">#{job.gpuId}</span></div>
            <div className="row"><span className="row-label">Duration</span><span className="row-value">{job.duration} hrs</span></div>
            <div className="row"><span className="row-label">Escrowed</span><span className="row-value gradient-green" style={{ fontWeight: 700 }}>{job.cost} ETH</span></div>
            <div className="row"><span className="row-label">Completed</span><span className={`badge ${job.completed?"badge-green":"badge-gray"}`}>{job.completed?"Yes":"No"}</span></div>
            <div className="row"><span className="row-label">NFT Minted</span><span className={`badge ${job.minted?"badge-purple":"badge-gray"}`}>{job.minted?"Yes":"No"}</span></div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-3)", fontSize: 13 }}>Enter job ID above</div>
        )}

        <button className="btn btn-green btn-full" disabled={busy} onClick={completeJob}>
          {busy ? <><span className="anim-spin">⟳</span> Processing…</> : "Complete Job (Provider)"}
        </button>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={{ gridColumn: "1/-1" }}>
          <div className="terminal">
            {log.map((l, i) => {
              const [type, ...rest] = l.split("|");
              const cls = type==="ok"?"log-ok":type==="err"?"log-err":type==="tx"?"log-tx":type==="event"?"log-event":"log-info";
              const [time, ...msg] = rest.join("|").split(" ");
              return <div key={i} className="log-line"><span className="log-ts">{time}</span><span className={cls}>{msg.join(" ")}</span></div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
