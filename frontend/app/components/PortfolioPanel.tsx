"use client";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  getAddresses,
  GPU_MARKETPLACE_ABI,
  MODEL_NFT_ABI,
  MODEL_MARKETPLACE_ABI,
  META_AGENT_REGISTRY_ABI,
  META_AGENT_VAULT_ABI,
  ERC20_ABI,
} from "../lib/contracts";
import { getBoundName, lookupAddress } from "../lib/ens";
import type { FlowState } from "../page";

interface Props { wallet: string | null; chainId: number; flow: FlowState; }

type Section = "models" | "listings" | "gpus" | "jobs" | "vaults" | "ens";

interface ModelRow { tokenId: number; desc: string; score: number; listed: boolean; price?: string }
interface GpuRow   { gpuId: number; price: string; available: boolean; metadata: string }
interface JobRow   { jobId: number; gpuId: number; status: string; cost: string; isRenter: boolean; isProvider: boolean }
interface VaultRow { agentId: number; vault: string; sharesFmt: string; navFmt: string; ensName?: string|null }

const fmtUsdc = (raw: bigint) => (Number(raw)/1e6).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtShr  = (raw: bigint) => (Number(raw)/1e18).toLocaleString("en-US",{maximumFractionDigits:4});
const short   = (a: string)   => `${a.slice(0,6)}…${a.slice(-4)}`;

export default function PortfolioPanel({ wallet, chainId, flow }: Props) {
  const [section, setSection] = useState<Section>("models");
  const [loading, setLoading] = useState(false);
  const [models,   setModels]   = useState<ModelRow[]>([]);
  const [gpus,     setGpus]     = useState<GpuRow[]>([]);
  const [jobs,     setJobs]     = useState<JobRow[]>([]);
  const [vaults,   setVaults]   = useState<VaultRow[]>([]);
  const [ensName,  setEnsName]  = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet || typeof window === "undefined" || !window.ethereum) return;
    setLoading(true);
    try {
      const addr = getAddresses(chainId);
      const p = new ethers.BrowserProvider(window.ethereum);
      const me = wallet.toLowerCase();

      // ── Model NFTs (owned + listings by you) ───────────────────────
      const nft = new ethers.Contract(addr.ModelNFT, MODEL_NFT_ABI, p);
      const mkt = new ethers.Contract(addr.ModelMarketplace, MODEL_MARKETPLACE_ABI, p);
      const next: bigint = await nft.nextTokenId();
      const m: ModelRow[] = [];
      for (let id = 1n; id < next; id++) {
        try {
          const [owner, score, uri, listing] = await Promise.all([
            nft.ownerOf(id),
            nft.performanceScore(id),
            nft.tokenURI(id),
            mkt.listings(id),
          ]);
          const isOwner = owner.toLowerCase() === me;
          const listedSeller: string = listing[1];
          const isListedByMe = listedSeller.toLowerCase() === me && listing[3];
          if (!isOwner && !isListedByMe) continue;

          let desc = `Model #${id}`;
          try {
            if (uri.startsWith("data:")) {
              const meta = JSON.parse(atob(uri.split(",")[1]));
              desc = meta.description ?? meta.name ?? desc;
            } else if (uri && uri.length < 200) desc = uri;
          } catch {}
          const s = Number(score);
          m.push({
            tokenId: Number(id),
            desc,
            score: s > 100 ? Math.round(s/100) : s,
            listed: isListedByMe,
            price: isListedByMe ? ethers.formatEther(listing[2]) : undefined,
          });
        } catch {}
      }
      setModels(m);

      // ── GPUs (listed by you) ────────────────────────────────────────
      const gpu = new ethers.Contract(addr.GPUMarketplace, GPU_MARKETPLACE_ABI, p);
      let nextGpu = 0n;
      try { nextGpu = await gpu.nextGpuId(); } catch {}
      const g: GpuRow[] = [];
      for (let id = 0n; id < nextGpu; id++) {
        try {
          const r = await gpu.getGPU(id);
          if (r[0].toLowerCase() !== me) continue;
          g.push({
            gpuId:     Number(id),
            price:     ethers.formatEther(r[1]),
            metadata:  r[2],
            available: r[3],
          });
        } catch {}
      }
      setGpus(g);

      // ── Jobs (where you're renter or provider) ─────────────────────
      const j: JobRow[] = [];
      let nextJob = 0n;
      try { nextJob = await gpu.nextJobId(); } catch {}
      for (let id = 0n; id < nextJob; id++) {
        try {
          const r = await gpu.getJob(id);
          const renter: string   = r[1];
          const provider: string = r[6] ?? r.provider ?? "";
          // getJob signature: (gpuId, renter, duration, totalCost, status, startedAt, ...) — robust check
          // Use renter from r[1]; fetch GPU to find provider
          let providerAddr = "";
          try {
            const gpuId: bigint = r[0];
            const gpuRow = await gpu.getGPU(gpuId);
            providerAddr = gpuRow[0];
          } catch {}
          const isRenter   = renter.toLowerCase() === me;
          const isProvider = providerAddr.toLowerCase() === me;
          if (!isRenter && !isProvider) continue;
          const statusNum = Number(r[4]);
          const status = ["Created","Running","Completed","Cancelled"][statusNum] ?? `S${statusNum}`;
          j.push({
            jobId:    Number(id),
            gpuId:    Number(r[0]),
            status,
            cost:     ethers.formatEther(r[3]),
            isRenter,
            isProvider,
          });
        } catch {}
      }
      setJobs(j);

      // ── Vaults (where you hold shares) + ENS bindings ──────────────
      const reg = new ethers.Contract(addr.MetaAgentRegistry, META_AGENT_REGISTRY_ABI, p);
      let nextAgent = 0n;
      try { nextAgent = await reg.nextAgentId(); } catch {}
      const v: VaultRow[] = [];
      for (let i = 0n; i < nextAgent; i++) {
        try {
          const vAddr: string = await reg.vaultOf(i);
          if (!vAddr || vAddr === ethers.ZeroAddress) continue;
          const vault = new ethers.Contract(vAddr, META_AGENT_VAULT_ABI, p);
          const [shares, totalAssets] = await Promise.all([
            vault.balanceOf(wallet),
            vault.totalAssets(),
          ]);
          if (shares === 0n) {
            // Also include if you're the operator (own the agentId NFT)
            try {
              const owner = await reg.ownerOf(i);
              if (owner.toLowerCase() !== me) continue;
            } catch { continue; }
          }
          let ensN: string | null = getBoundName(vAddr);
          if (!ensN && (chainId === 1 || chainId === 11155111)) {
            ensN = await lookupAddress(p, vAddr);
          }
          v.push({
            agentId:   Number(i),
            vault:     vAddr,
            sharesFmt: fmtShr(shares),
            navFmt:    fmtUsdc(totalAssets),
            ensName:   ensN,
          });
        } catch {}
      }
      setVaults(v);

      // ── Reverse-resolve own ENS name ────────────────────────────────
      if (chainId === 1 || chainId === 11155111) {
        setEnsName(await lookupAddress(p, wallet));
      } else {
        setEnsName(null);
      }
    } finally {
      setLoading(false);
    }
  }, [wallet, chainId]);

  useEffect(() => { load(); }, [load]);

  const counts = {
    models:   models.length,
    listings: models.filter(m => m.listed).length,
    gpus:     gpus.length,
    jobs:     jobs.length,
    vaults:   vaults.length,
    ens:      ensName ? 1 : 0,
  };

  if (!wallet) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
        Connect your wallet to see your portfolio.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16 }}>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside className="card" style={{ padding: 12, height: "fit-content", position: "sticky", top: 76 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, padding: "0 4px" }}>
          Inventory
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 12, padding: "0 4px", wordBreak: "break-all" }}>
          {ensName ? <span style={{ color: "var(--blue)", fontWeight: 600 }}>{ensName}</span> : null}
          {ensName && <br />}
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>{short(wallet)}</span>
        </div>
        {([
          ["models",   "Model NFTs",        counts.models],
          ["listings", "Active Listings",   counts.listings],
          ["gpus",     "GPUs Listed",       counts.gpus],
          ["jobs",     "Jobs",              counts.jobs],
          ["vaults",   "Vault Positions",   counts.vaults],
          ["ens",      "ENS Identity",      counts.ens],
        ] as [Section, string, number][]).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setSection(k)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", padding: "8px 10px", marginBottom: 2,
              background: section === k ? "var(--blue-dim)" : "transparent",
              border: "none", borderRadius: 4, cursor: "pointer",
              fontSize: 12, fontWeight: section === k ? 600 : 500,
              color: section === k ? "var(--blue)" : "var(--text-primary)",
              textAlign: "left",
            }}
          >
            <span>{label}</span>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{n}</span>
          </button>
        ))}
        <button
          onClick={load}
          disabled={loading}
          style={{
            width: "100%", marginTop: 8, padding: "6px 10px",
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 4, fontSize: 11, cursor: loading ? "wait" : "pointer",
            color: "var(--text-secondary)",
          }}
        >
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </aside>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <div className="section-eyebrow">Portfolio</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em" }}>Your On-Chain Inventory</h2>
          <div className="section-sub">Everything tied to <code style={{ fontSize: 11 }}>{short(wallet)}</code> across the AlphaTrade contracts.</div>
        </div>

        {/* MODELS ──────────────────────────────────────────────── */}
        {section === "models" && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>
              Model NFTs ({counts.models})
            </div>
            {models.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                You don't own or have listed any model NFTs.
              </div>
            ) : (
              <table className="data-table" style={{ width: "100%" }}>
                <thead><tr><th>Token</th><th>Description</th><th>Score</th><th>State</th><th>Action</th></tr></thead>
                <tbody>
                  {models.map(m => (
                    <tr key={m.tokenId}>
                      <td><span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>#{m.tokenId}</span></td>
                      <td style={{ fontSize: 12 }}>{m.desc}</td>
                      <td>
                        {m.score > 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: m.score > 80 ? "var(--green)" : "var(--text-secondary)" }}>
                            {m.score}/100
                          </span>
                        ) : <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>—</span>}
                      </td>
                      <td>
                        {m.listed ? (
                          <span className="badge badge-blue">Listed · {m.price} ETH</span>
                        ) : (
                          <span className="badge badge-green">Owned</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => { flow.setLastTokenId(String(m.tokenId)); flow.setTab("market"); }}
                        >
                          Trade →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* LISTINGS ─────────────────────────────────────────────── */}
        {section === "listings" && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>
              Active Listings ({counts.listings})
            </div>
            {counts.listings === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                You haven't listed any NFTs for sale.
              </div>
            ) : (
              <table className="data-table" style={{ width: "100%" }}>
                <thead><tr><th>Token</th><th>Description</th><th>Price</th></tr></thead>
                <tbody>
                  {models.filter(m => m.listed).map(m => (
                    <tr key={m.tokenId}>
                      <td><span className="mono" style={{ fontSize: 11 }}>#{m.tokenId}</span></td>
                      <td style={{ fontSize: 12 }}>{m.desc}</td>
                      <td><span style={{ fontWeight: 700, fontFamily: "JetBrains Mono", fontSize: 12 }}>{m.price} ETH</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* GPUS ─────────────────────────────────────────────────── */}
        {section === "gpus" && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>
              GPUs You've Listed ({counts.gpus})
            </div>
            {gpus.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                You haven't listed any GPUs.
              </div>
            ) : (
              <table className="data-table" style={{ width: "100%" }}>
                <thead><tr><th>GPU</th><th>Metadata</th><th>Price/hr</th><th>State</th></tr></thead>
                <tbody>
                  {gpus.map(g => (
                    <tr key={g.gpuId}>
                      <td><span className="mono" style={{ fontSize: 11 }}>#{g.gpuId}</span></td>
                      <td style={{ fontSize: 12 }}>{g.metadata.length > 60 ? g.metadata.slice(0,56) + "…" : g.metadata}</td>
                      <td><span style={{ fontFamily: "JetBrains Mono", fontSize: 12 }}>{g.price} ETH</span></td>
                      <td>
                        <span className={`badge ${g.available ? "badge-green" : "badge-gray"}`}>
                          {g.available ? "Available" : "Rented"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* JOBS ─────────────────────────────────────────────────── */}
        {section === "jobs" && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>
              Jobs ({counts.jobs})
            </div>
            {jobs.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                No jobs as renter or provider.
              </div>
            ) : (
              <table className="data-table" style={{ width: "100%" }}>
                <thead><tr><th>Job</th><th>GPU</th><th>Role</th><th>Cost</th><th>Status</th></tr></thead>
                <tbody>
                  {jobs.map(j => (
                    <tr key={j.jobId}>
                      <td><span className="mono" style={{ fontSize: 11 }}>#{j.jobId}</span></td>
                      <td><span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>GPU #{j.gpuId}</span></td>
                      <td style={{ fontSize: 11 }}>
                        {j.isRenter && <span className="badge badge-blue">Renter</span>}
                        {j.isProvider && <span className="badge badge-purple" style={{ marginLeft: 4 }}>Provider</span>}
                      </td>
                      <td><span style={{ fontFamily: "JetBrains Mono", fontSize: 12 }}>{j.cost} ETH</span></td>
                      <td>
                        <span className={`badge ${j.status === "Completed" ? "badge-green" : j.status === "Cancelled" ? "badge-gray" : "badge-blue"}`}>
                          {j.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* VAULTS ───────────────────────────────────────────────── */}
        {section === "vaults" && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>
              Vault Positions ({counts.vaults})
            </div>
            {vaults.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                You don't hold shares in any vault. Deposit USDC from the Meta-Agents tab.
              </div>
            ) : (
              <table className="data-table" style={{ width: "100%" }}>
                <thead><tr><th>Agent</th><th>Vault / ENS</th><th>Your Shares</th><th>Vault NAV</th><th>Action</th></tr></thead>
                <tbody>
                  {vaults.map(v => (
                    <tr key={v.agentId}>
                      <td><span className="mono" style={{ fontSize: 11 }}>#{v.agentId}</span></td>
                      <td style={{ fontSize: 11 }}>
                        {v.ensName ? (
                          <span style={{ color: "var(--blue)", fontWeight: 600 }}>{v.ensName}</span>
                        ) : (
                          <span className="mono">{short(v.vault)}</span>
                        )}
                      </td>
                      <td><span style={{ fontFamily: "JetBrains Mono", fontSize: 12 }}>{v.sharesFmt}</span></td>
                      <td><span style={{ fontFamily: "JetBrains Mono", fontSize: 12 }}>{v.navFmt} USDC</span></td>
                      <td>
                        <button className="btn btn-xs btn-ghost" onClick={() => flow.setTab("agents")}>
                          Manage →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ENS ──────────────────────────────────────────────────── */}
        {section === "ens" && (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>ENS Identity</div>
            {ensName ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--blue)", marginBottom: 8 }}>{ensName}</div>
                <a
                  href={`https://app.ens.domains/${ensName}`}
                  target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: "var(--blue)", textDecoration: "underline" }}
                >
                  View on ENS app ↗
                </a>
                <div style={{ marginTop: 16, padding: 12, background: "var(--bg-raised)", borderRadius: 6, fontSize: 12, color: "var(--text-secondary)" }}>
                  This is the primary ENS name set for your wallet. AlphaTrade vaults you operate can be bound to subnames you control —
                  go to a vault's <strong>Details</strong> drawer to set <code>eth.alphatrade.*</code> text records.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.6 }}>
                {chainId === 1 || chainId === 11155111
                  ? <>No primary ENS name set for this wallet. Register one at{" "}
                    <a href="https://sepolia.app.ens.domains/" target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>app.ens.domains</a>
                    {" "}then set it as your primary in the Records tab.</>
                  : <>ENS lookups only work on Sepolia (chainId 11155111) or Mainnet. Switch networks to see your ENS identity.</>
                }
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
