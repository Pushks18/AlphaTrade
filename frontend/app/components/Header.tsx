"use client";

declare global { interface Window { ethereum?: any } }

interface Props {
  wallet: string | null;
  setWallet: (w: string | null) => void;
  chainId: number;
  setChainId: (c: number) => void;
}

const NET: Record<number, { label: string; color: string }> = {
  31337:    { label: "Local Anvil", color: "#fb923c" },
  11155111: { label: "Sepolia",     color: "#60a5fa" },
};

export default function Header({ wallet, setWallet, chainId, setChainId }: Props) {
  async function connect() {
    if (!window.ethereum) return alert("Install MetaMask to connect a wallet");
    try {
      const [acct] = await window.ethereum.request({ method: "eth_requestAccounts" });
      const cid = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
      setWallet(acct);
      setChainId(cid);
      window.ethereum.on("accountsChanged", (a: string[]) => setWallet(a[0] ?? null));
      window.ethereum.on("chainChanged",    (c: string)   => setChainId(parseInt(c, 16)));
    } catch {}
  }

  const net = NET[chainId] ?? { label: `Chain ${chainId}`, color: "#94a3b8" };

  return (
    <header style={{
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(2,4,10,0.8)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      position: "sticky", top: 0, zIndex: 100,
    }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11,
            background: "linear-gradient(135deg,#3b82f6 0%,#22d3ee 50%,#a78bfa 100%)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19,
            boxShadow: "0 0 20px rgba(59,130,246,0.4)",
          }}>⚡</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.04em", lineHeight: 1 }}>
              <span className="gradient-brand">ComputeX</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              GPU Compute × AI Models × Onchain Trading
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <a href="https://sepolia.etherscan.io/address/0xefE063A1876Bf0FB4Bb8BF1566A5B74B000f4654"
            target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: "var(--text-3)", textDecoration: "none", padding: "6px 12px", borderRadius: 7, transition: "color .2s" }}
            onMouseOver={e=>(e.currentTarget.style.color="var(--text-1)")}
            onMouseOut={e=>(e.currentTarget.style.color="var(--text-3)")}
          >Etherscan ↗</a>
          <a href="https://github.com" target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: "var(--text-3)", textDecoration: "none", padding: "6px 12px", borderRadius: 7, transition: "color .2s" }}
            onMouseOver={e=>(e.currentTarget.style.color="var(--text-1)")}
            onMouseOut={e=>(e.currentTarget.style.color="var(--text-3)")}
          >GitHub ↗</a>
        </nav>

        {/* Wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {wallet && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 12px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: net.color, boxShadow: `0 0 8px ${net.color}` }} />
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>{net.label}</span>
            </div>
          )}
          <button className="btn btn-blue btn-sm" onClick={connect}>
            {wallet ? `${wallet.slice(0,6)}…${wallet.slice(-4)}` : "Connect Wallet"}
          </button>
        </div>
      </div>
    </header>
  );
}
