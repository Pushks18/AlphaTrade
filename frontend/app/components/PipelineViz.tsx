"use client";
import type { Tab } from "../page";

const STEPS = [
  { key: "gpu",    icon: "🖥",  label: "List\nGPU" },
  { key: "jobs",   icon: "⚙️",  label: "Rent &\nTrain" },
  { key: "nfts",   icon: "🧠",  label: "Mint\niNFT" },
  { key: "market", icon: "🛒",  label: "Trade\nModel" },
  { key: "agent",  icon: "📈",  label: "Execute\nTrade" },
];

export default function PipelineViz({ activeTab }: { activeTab: Tab }) {
  const idx = ["gpu","jobs","nfts","market"].indexOf(activeTab);
  return (
    <div className="card" style={{ padding: "22px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".08em" }}>ComputeX Pipeline</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 3 }}>
            Decentralized GPU compute → AI model ownership → autonomous trading
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span className="badge badge-blue">0G Chain</span>
          <span className="badge badge-purple">ERC-7857</span>
          <span className="badge badge-cyan">KeeperHub</span>
        </div>
      </div>

      <div className="pipeline">
        {STEPS.map((step, i) => {
          const status = i < idx ? "done" : i === idx ? "active" : "pending";
          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : 0 }}>
              <div className="pipe-step">
                <div className={`pipe-dot ${status}`}>{step.icon}</div>
                <div className={`pipe-lbl ${status}`} style={{ whiteSpace: "pre-line" }}>{step.label}</div>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`pipe-line ${status}`} style={{ flex: 1, margin: "0 6px", marginBottom: 22 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
