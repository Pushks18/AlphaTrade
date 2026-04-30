"use client";
import type { Tab } from "../page";

const STEPS: { key: string; label: string; n: string }[] = [
  { key: "gpu",    label: "List GPU",    n: "01" },
  { key: "jobs",   label: "Rent & Train", n: "02" },
  { key: "nfts",   label: "Mint iNFT",   n: "03" },
  { key: "market", label: "Trade Model", n: "04" },
  { key: "agent",  label: "Run Agent",   n: "05" },
];

export default function PipelineViz({ activeTab }: { activeTab: Tab }) {
  const idx = ["gpu", "jobs", "nfts", "market"].indexOf(activeTab);

  return (
    <div className="card" style={{ padding: "20px 24px" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
        gap: 16,
        flexWrap: "wrap",
      }}>
        <div>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 3,
          }}>
            On-Chain Workflow
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            GPU compute → model training → iNFT minting → autonomous trading
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="pill">0G Chain</span>
          <span className="pill">ERC-7857</span>
          <span className="pill">KeeperHub</span>
        </div>
      </div>

      <div className="pipeline">
        {STEPS.map((step, i) => {
          const status = i < idx ? "done" : i === idx ? "active" : "pending";
          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : 0 }}>
              <div className="pipe-node">
                <div className={`pipe-circle ${status}`}>
                  {status === "done" ? "✓" : step.n}
                </div>
                <div className={`pipe-label ${status}`}>{step.label}</div>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`pipe-connector ${status}`}
                  style={{ flex: 1, margin: "0 4px", marginBottom: 18 }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
