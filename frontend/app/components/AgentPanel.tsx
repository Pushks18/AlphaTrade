"use client";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  getAddresses,
  META_AGENT_REGISTRY_ABI,
  META_AGENT_VAULT_ABI,
  ERC20_ABI,
} from "../lib/contracts";
import VaultDetail from "./VaultDetail";
import { lookupAddress, getBoundName } from "../lib/ens";

interface Props { wallet: string | null; chainId: number; }
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

interface VaultRow {
  agentId:    number;
  vault:      string;
  nav:        string;   // raw USDC units (6 dec)
  navFmt:     string;
  shares:     string;
  perfFee:    number;
  userShares: string;
  userSharesFmt: string;
  ensName?:   string | null;
}

function fmtUsdc(raw: bigint): string {
  const n = Number(raw) / 1e6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShares(raw: bigint): string {
  const n = Number(raw) / 1e18;
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function short(addr: string) { return addr.slice(0, 6) + "…" + addr.slice(-4); }

export default function AgentPanel({ wallet, chainId }: Props) {
  const [vaults,      setVaults]      = useState<VaultRow[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [selected,    setSelected]    = useState<VaultRow | null>(null);
  const [depositAmt,  setDepositAmt]  = useState("10");
  const [redeemAmt,   setRedeemAmt]   = useState("");
  const [log,         setLog]         = useState<string[]>([]);
  const [busy,        setBusy]        = useState(false);
  const [view,        setView]        = useState<"leaderboard" | "deploy">("leaderboard");
  const [perfFee,     setPerfFee]     = useState("500");
  const [userBalance, setUserBalance] = useState<string>("0.00");
  const [detailVault, setDetailVault] = useState<VaultRow | null>(null);

  const addLog = (msg: string, type = "info") => setLog(l => [...l, `${type}|${ts()} ${msg}`]);

  const getSigner = async () => {
    const p = new ethers.BrowserProvider(window.ethereum);
    return p.getSigner();
  };
  const addr = getAddresses(chainId);

  // ── load vaults ──────────────────────────────────────────────────────────
  const loadVaults = useCallback(async () => {
    setLoading(true);
    try {
      const p = new ethers.BrowserProvider(window.ethereum);
      const reg = new ethers.Contract(addr.MetaAgentRegistry, META_AGENT_REGISTRY_ABI, p);
      const next = Number(await reg.nextAgentId());
      const rows: VaultRow[] = [];
      for (let i = 0; i < next; i++) {
        try {
          const vaultAddr: string = await reg.vaultOf(i);
          if (!vaultAddr || vaultAddr === ethers.ZeroAddress) continue;
          const vault = new ethers.Contract(vaultAddr, META_AGENT_VAULT_ABI, p);
          const [nav, supply, perfFeeBps] = await Promise.all([
            vault.totalAssets(),
            vault.totalSupply(),
            vault.perfFeeBps(),
          ]);
          let userSharesRaw = 0n;
          if (wallet) {
            userSharesRaw = await vault.balanceOf(wallet);
          }
          // ENS: prefer manually-bound name, otherwise reverse lookup.
          // Reverse lookup only succeeds on Sepolia/mainnet for addresses
          // that have set a primary name; otherwise it's null.
          let ensName: string | null = getBoundName(vaultAddr);
          if (!ensName && (chainId === 1 || chainId === 11155111)) {
            ensName = await lookupAddress(p, vaultAddr);
          }
          rows.push({
            agentId:       i,
            vault:         vaultAddr,
            nav:           nav.toString(),
            navFmt:        fmtUsdc(nav),
            shares:        supply.toString(),
            perfFee:       Number(perfFeeBps),
            userShares:    userSharesRaw.toString(),
            userSharesFmt: fmtShares(userSharesRaw),
            ensName,
          });
        } catch { /* skip malformed vault */ }
      }
      rows.sort((a, b) => Number(BigInt(b.nav) - BigInt(a.nav)));
      setVaults(rows);
    } catch (e: any) {
      addLog(`Failed to load vaults: ${e.message?.slice(0, 80)}`, "err");
    }
    setLoading(false);
  }, [addr.MetaAgentRegistry, wallet]);

  // load user USDC balance
  const loadBalance = useCallback(async () => {
    if (!wallet || !addr.MockUSDC) return;
    try {
      const p = new ethers.BrowserProvider(window.ethereum);
      const usdc = new ethers.Contract(addr.MockUSDC, ERC20_ABI, p);
      const bal = await usdc.balanceOf(wallet);
      setUserBalance(fmtUsdc(bal));
    } catch { /* ignore */ }
  }, [wallet, addr.MockUSDC]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.ethereum) {
      loadVaults();
      loadBalance();
    }
  }, [loadVaults, loadBalance]);

  // ── mint mock USDC (testnet helper) ──────────────────────────────────────
  async function mintUsdc() {
    if (!wallet) return alert("Connect wallet first");
    setBusy(true);
    try {
      const s = await getSigner();
      const usdc = new ethers.Contract(addr.MockUSDC, ERC20_ABI, s);
      addLog("Minting 1,000 MockUSDC to your wallet…");
      const tx = await usdc.mint(wallet, 1_000n * 1_000_000n); // 1000 USDC (6 dec)
      addLog(`Tx: ${tx.hash}`, "tx");
      await tx.wait();
      addLog("Minted 1,000 USDC", "ok");
      await loadBalance();
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 80)}`, "err"); }
    setBusy(false);
  }

  // ── deposit into selected vault ───────────────────────────────────────────
  async function deposit() {
    if (!wallet || !selected) return;
    setBusy(true);
    try {
      const s = await getSigner();
      const usdc  = new ethers.Contract(addr.MockUSDC, ERC20_ABI, s);
      const vault = new ethers.Contract(selected.vault, META_AGENT_VAULT_ABI, s);
      const amt   = BigInt(Math.round(parseFloat(depositAmt) * 1e6));
      addLog(`Approving ${depositAmt} USDC → vault ${short(selected.vault)}…`);
      const t1 = await usdc.approve(selected.vault, amt);
      addLog(`Approval: ${t1.hash}`, "tx"); await t1.wait();
      addLog("Depositing…");
      const t2 = await vault.deposit(amt, wallet);
      addLog(`Deposit: ${t2.hash}`, "tx");
      const rc = await t2.wait();
      const ev = rc?.logs.find((l: any) => l.fragment?.name === "Deposit");
      const shares = ev ? fmtShares(ev.args[3]) : "?";
      addLog(`Deposited ${depositAmt} USDC — got ${shares} shares`, "ok");
      await Promise.all([loadVaults(), loadBalance()]);
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 80)}`, "err"); }
    setBusy(false);
  }

  // ── redeem shares ─────────────────────────────────────────────────────────
  async function redeem() {
    if (!wallet || !selected) return;
    setBusy(true);
    try {
      const s = await getSigner();
      const vault = new ethers.Contract(selected.vault, META_AGENT_VAULT_ABI, s);
      const shares = ethers.parseUnits(redeemAmt || "0", 18);
      addLog(`Redeeming ${redeemAmt} shares from vault ${short(selected.vault)}…`);
      const tx = await vault.redeem(shares, wallet, wallet);
      addLog(`Tx: ${tx.hash}`, "tx"); await tx.wait();
      addLog("Redeemed successfully", "ok");
      await Promise.all([loadVaults(), loadBalance()]);
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 80)}`, "err"); }
    setBusy(false);
  }

  // ── harvest perf fee ──────────────────────────────────────────────────────
  async function harvest() {
    if (!wallet || !selected) return;
    setBusy(true);
    try {
      const s = await getSigner();
      const vault = new ethers.Contract(selected.vault, META_AGENT_VAULT_ABI, s);
      addLog(`Harvesting vault ${short(selected.vault)}…`);
      const tx = await vault.harvest();
      addLog(`Tx: ${tx.hash}`, "tx"); await tx.wait();
      addLog("Harvest complete", "ok");
      await loadVaults();
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 80)}`, "err"); }
    setBusy(false);
  }

  // ── deploy new agent ──────────────────────────────────────────────────────
  async function deployAgent() {
    if (!wallet) return alert("Connect wallet first");
    setBusy(true);
    try {
      const s = await getSigner();
      const reg = new ethers.Contract(addr.MetaAgentRegistry, META_AGENT_REGISTRY_ABI, s);
      const feeBps = parseInt(perfFee);
      if (feeBps > 2000) { addLog("Max perf fee is 20% (2000 bps)", "err"); setBusy(false); return; }
      const policyHash = ethers.keccak256(ethers.toUtf8Bytes(`policy-${wallet}-${Date.now()}`));
      addLog(`Deploying agent (perfFee=${feeBps} bps)…`);
      const tx = await reg.deploy(feeBps, policyHash);
      addLog(`Tx: ${tx.hash}`, "tx");
      const rc = await tx.wait();
      const ev = rc?.logs.find((l: any) => l.fragment?.name === "AgentDeployed");
      const agentId = ev ? ev.args[0].toString() : "?";
      addLog(`Agent #${agentId} deployed — vault: ${ev ? short(ev.args[2]) : "?"}`, "ok");
      setView("leaderboard");
      await loadVaults();
    } catch (e: any) { addLog(`${e.reason ?? e.message?.slice(0, 80)}`, "err"); }
    setBusy(false);
  }

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", fontSize: 12, fontWeight: 600,
    border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)",
    cursor: "pointer",
    background: active ? "var(--text-primary)" : "var(--bg-card)",
    color:      active ? "var(--bg)"           : "var(--text-primary)",
  });

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 13,
    border: "1px solid var(--border)", borderRadius: "var(--r-sm)",
    background: "var(--bg-input)", color: "var(--text-primary)", fontFamily: "inherit",
  };

  const actionBtn = (disabled?: boolean): React.CSSProperties => ({
    padding: "9px 18px", fontSize: 13, fontWeight: 600,
    border: "none", borderRadius: "var(--r-sm)", cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "var(--bg-muted)" : "var(--text-primary)",
    color: disabled ? "var(--text-tertiary)" : "var(--bg)",
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>

      {/* ── Left: leaderboard / deploy ─────────────────────────────────── */}
      <div>
        {/* sub-nav */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button style={btnStyle(view === "leaderboard")} onClick={() => setView("leaderboard")}>
            Leaderboard
          </button>
          <button style={btnStyle(view === "deploy")} onClick={() => setView("deploy")}>
            Deploy Agent
          </button>
          <button
            style={{ ...btnStyle(false), marginLeft: "auto" }}
            onClick={() => { loadVaults(); loadBalance(); }}
          >
            ↻ Refresh
          </button>
        </div>

        {view === "leaderboard" && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Active Meta-Agent Vaults</span>
              {loading && <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Loading…</span>}
            </div>

            {/* header row */}
            <div style={{
              display: "grid", gridTemplateColumns: "48px 1fr 110px 80px 80px 100px",
              padding: "8px 16px", borderBottom: "1px solid var(--border)",
              fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600, letterSpacing: "0.05em",
            }}>
              <span>#</span>
              <span>Vault</span>
              <span style={{ textAlign: "right" }}>NAV (USDC)</span>
              <span style={{ textAlign: "right" }}>Perf Fee</span>
              <span style={{ textAlign: "right" }}>My Shares</span>
              <span style={{ textAlign: "right" }}>Action</span>
            </div>

            {vaults.length === 0 && !loading && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
                No agents deployed yet.{" "}
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", textDecoration: "underline", fontSize: 13 }}
                  onClick={() => setView("deploy")}
                >
                  Deploy one →
                </button>
              </div>
            )}

            {vaults.map((v, i) => (
              <div
                key={v.agentId}
                onClick={() => setSelected(v)}
                style={{
                  display: "grid", gridTemplateColumns: "48px 1fr 110px 80px 80px 100px",
                  padding: "12px 16px", alignItems: "center", cursor: "pointer",
                  background: selected?.agentId === v.agentId ? "var(--blue-dim)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                  transition: "background 0.15s",
                }}
              >
                <span style={{ fontWeight: 700, color: i === 0 ? "var(--green)" : "var(--text-secondary)" }}>
                  {i === 0 ? "🥇" : `#${i + 1}`}
                </span>
                <div>
                  {v.ensName ? (
                    <>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--blue)" }}>
                        {v.ensName}
                      </span>
                      <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 2, fontFamily: "JetBrains Mono, monospace" }}>
                        {short(v.vault)} · Agent #{v.agentId}
                      </div>
                    </>
                  ) : (
                    <>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
                        {short(v.vault)}
                      </span>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                        Agent #{v.agentId}
                      </div>
                    </>
                  )}
                </div>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {v.navFmt}
                </span>
                <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                  {(v.perfFee / 100).toFixed(0)}%
                </span>
                <span style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>
                  {v.userSharesFmt}
                </span>
                <div style={{ textAlign: "right", display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button
                    onClick={e => { e.stopPropagation(); setDetailVault(v); }}
                    style={{
                      padding: "4px 10px", fontSize: 11, fontWeight: 600,
                      border: "1px solid var(--border)", borderRadius: 4,
                      background: "var(--bg-card)", color: "var(--text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    Details
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setSelected(v); }}
                    style={{ ...actionBtn(false), padding: "4px 10px", fontSize: 11 }}
                  >
                    Deposit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === "deploy" && (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Deploy New Meta-Agent</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
              Deploying creates an ERC-4626 vault and mints you the operator NFT (ERC-721 agentId).
              Users can deposit USDC; your Python runtime calls <code>executeTrade</code> hourly.
            </p>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Performance Fee (bps, max 2000)
              </label>
              <input
                style={inputStyle}
                value={perfFee}
                onChange={e => setPerfFee(e.target.value)}
                placeholder="500"
                type="number" min="0" max="2000"
              />
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                {parseInt(perfFee) / 100 || 0}% of gains taken at harvest. Charged in vault shares.
              </div>
            </div>
            <button style={actionBtn(!wallet || busy)} onClick={deployAgent} disabled={!wallet || busy}>
              {busy ? "Deploying…" : "Deploy Agent Vault"}
            </button>
          </div>
        )}
      </div>

      {/* ── Right: deposit / redeem panel ────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Wallet USDC balance */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600, marginBottom: 6, letterSpacing: "0.05em" }}>
            YOUR MOCK USDC BALANCE
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {userBalance} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>USDC</span>
          </div>
          {/* Faucet works on Anvil (31337) and Sepolia (11155111). Both use MockERC20 with open mint. */}
          {(chainId === 31337 || chainId === 11155111) && (
            <button
              style={{ ...actionBtn(!wallet || busy), marginTop: 10, width: "100%", fontSize: 12 }}
              onClick={mintUsdc} disabled={!wallet || busy}
            >
              Faucet: Mint 1,000 USDC
            </button>
          )}
        </div>

        {/* Deposit / Redeem */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: "var(--text-primary)" }}>
            {selected ? `Vault #${selected.agentId}` : "Select a vault →"}
          </div>

          {selected && (
            <>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 8 }}>
                <div>NAV: <strong>{selected.navFmt} USDC</strong></div>
                <div style={{ marginTop: 4, fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>
                  {selected.vault}
                </div>
              </div>

              <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }} />

              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 5 }}>Deposit (USDC)</label>
                <input style={inputStyle} value={depositAmt} onChange={e => setDepositAmt(e.target.value)} placeholder="10.00" type="number" min="0" />
              </div>
              <button style={{ ...actionBtn(!wallet || busy), width: "100%", marginBottom: 12 }}
                onClick={deposit} disabled={!wallet || busy}>
                {busy ? "…" : "Deposit"}
              </button>

              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 5 }}>
                  Redeem (shares) — you have {selected.userSharesFmt}
                </label>
                <input style={inputStyle} value={redeemAmt}
                  onChange={e => setRedeemAmt(e.target.value)}
                  placeholder={selected.userSharesFmt} type="number" min="0" />
              </div>
              <button style={{ ...actionBtn(!wallet || busy || !redeemAmt), width: "100%", marginBottom: 16 }}
                onClick={redeem} disabled={!wallet || busy || !redeemAmt}>
                {busy ? "…" : "Redeem"}
              </button>

              <button
                style={{ ...actionBtn(!wallet || busy), width: "100%", fontSize: 12,
                  background: "var(--bg-raised)", color: "var(--text-primary)",
                  border: "1px solid var(--border)", }}
                onClick={harvest} disabled={!wallet || busy}
              >
                Harvest Perf Fee
              </button>
            </>
          )}
        </div>

        {/* Log */}
        {log.length > 0 && (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", marginBottom: 8, letterSpacing: "0.05em" }}>
              TX LOG
            </div>
            <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {log.map((l, i) => {
                const [type, ...rest] = l.split("|");
                const msg = rest.join("|");
                const color = type === "err" ? "var(--red)" : type === "ok" ? "var(--green)" : type === "tx" ? "var(--blue)" : "var(--text-secondary)";
                return (
                  <div key={i} style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color, lineHeight: 1.5, wordBreak: "break-all" }}>
                    {msg}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Slide-in detail drawer */}
      {detailVault && (
        <VaultDetail
          vaultAddr={detailVault.vault}
          agentId={detailVault.agentId}
          chainId={chainId}
          onClose={() => setDetailVault(null)}
        />
      )}
    </div>
  );
}
