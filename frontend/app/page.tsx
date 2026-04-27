"use client";
import { useState } from "react";
import Header from "./components/Header";
import PipelineViz from "./components/PipelineViz";
import GPUPanel from "./components/GPUPanel";
import JobPanel from "./components/JobPanel";
import NFTPanel from "./components/NFTPanel";
import MarketPanel from "./components/MarketPanel";

export type Tab = "gpu" | "jobs" | "nfts" | "market";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "gpu",    icon: "🖥",  label: "GPU Market" },
  { key: "jobs",   icon: "⚙️",  label: "Compute Jobs" },
  { key: "nfts",   icon: "🧠",  label: "Model NFTs" },
  { key: "market", icon: "🛒",  label: "Trade Models" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("gpu");
  const [wallet, setWallet] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number>(31337);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header wallet={wallet} setWallet={setWallet} chainId={chainId} setChainId={setChainId} />

      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 60px" }}>
        <PipelineViz activeTab={tab} />

        {/* Tab bar */}
        <div className="tabs" style={{ marginTop: 24, marginBottom: 28 }}>
          {TABS.map(t => (
            <button key={t.key} className={`tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="anim-fade-up" key={tab}>
          {tab === "gpu"    && <GPUPanel    wallet={wallet} chainId={chainId} />}
          {tab === "jobs"   && <JobPanel    wallet={wallet} chainId={chainId} />}
          {tab === "nfts"   && <NFTPanel    wallet={wallet} chainId={chainId} />}
          {tab === "market" && <MarketPanel wallet={wallet} chainId={chainId} />}
        </div>
      </main>
    </div>
  );
}
