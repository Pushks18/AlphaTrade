"use client";
import { useState } from "react";
import Header from "./components/Header";
import PipelineViz from "./components/PipelineViz";
import GPUPanel from "./components/GPUPanel";
import JobPanel from "./components/JobPanel";
import NFTPanel from "./components/NFTPanel";
import MarketPanel from "./components/MarketPanel";
import AgentPanel  from "./components/AgentPanel";

export type Tab = "gpu" | "jobs" | "nfts" | "market" | "agents";

const TABS: { key: Tab; num: string; label: string }[] = [
  { key: "gpu",    num: "01", label: "GPU Market"   },
  { key: "jobs",   num: "02", label: "Compute Jobs" },
  { key: "nfts",   num: "03", label: "Model NFTs"   },
  { key: "market", num: "04", label: "Trade"        },
  { key: "agents", num: "05", label: "Meta-Agents"  },
];

// Mock stats — would come from contract reads in prod
const STATS = [
  { label: "Active GPUs",    value: "24",     delta: "+3 today", up: true,  color: "var(--text-primary)" },
  { label: "Jobs Running",   value: "7",      delta: "+2 today", up: true,  color: "var(--blue)"         },
  { label: "Models Minted",  value: "142",    delta: "+12 wk",   up: true,  color: "var(--purple)"       },
  { label: "Meta-Agents",    value: "3",      delta: "+1 today", up: true,  color: "var(--cyan)"         },
  { label: "Total Volume",   value: "3.8 ETH",delta: "+0.6 ETH", up: true,  color: "var(--green)"        },
];

export default function Home() {
  const [tab,     setTab]     = useState<Tab>("gpu");
  const [wallet,  setWallet]  = useState<string | null>(null);
  const [chainId, setChainId] = useState<number>(31337);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header wallet={wallet} setWallet={setWallet} chainId={chainId} setChainId={setChainId} />

      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 24px 80px" }}>

        {/* ── Stats bar ── */}
        <div className="stats-bar" style={{ marginBottom: 20 }}>
          {STATS.map(s => (
            <div className="stat-cell" key={s.label}>
              <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
              <div className={`stat-delta ${s.up ? "up" : "down"}`}>{s.delta}</div>
            </div>
          ))}
        </div>

        {/* ── Pipeline ── */}
        <PipelineViz activeTab={tab} />

        {/* ── Tab bar ── */}
        <div style={{ marginTop: 24 }}>
          <div className="tabs" style={{ marginBottom: 20 }}>
            {TABS.map(t => (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                className={`tab${tab === t.key ? " active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                <span className="tab-num">{t.num}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Panel content ── */}
          <div className="anim-fade-up" key={tab}>
            {tab === "gpu"    && <GPUPanel    wallet={wallet} chainId={chainId} />}
            {tab === "jobs"   && <JobPanel    wallet={wallet} chainId={chainId} />}
            {tab === "nfts"   && <NFTPanel    wallet={wallet} chainId={chainId} />}
            {tab === "market" && <MarketPanel wallet={wallet} chainId={chainId} />}
            {tab === "agents" && <AgentPanel  wallet={wallet} chainId={chainId} />}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          marginTop: 56,
          paddingTop: 20,
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: "-0.02em" }}>+ ALPHATRADE</span>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              Decentralized GPU Compute & AI Model Marketplace on 0G Chain
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {["0G Chain", "ERC-7857", "KeeperHub", "Uniswap V3"].map(t => (
              <span key={t} className="pill" style={{ fontSize: 11 }}>{t}</span>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
