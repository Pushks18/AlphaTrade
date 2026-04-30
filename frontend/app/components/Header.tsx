"use client";

declare global { interface Window { ethereum?: any } }

interface Props {
  wallet: string | null;
  setWallet: (w: string | null) => void;
  chainId: number;
  setChainId: (c: number) => void;
}

const NET: Record<number, { label: string; dot: string }> = {
  31337:    { label: "Local Anvil", dot: "dot-orange" },
  11155111: { label: "Sepolia",    dot: "dot-blue"   },
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

  const net = NET[chainId] ?? { label: `Chain ${chainId}`, dot: "dot-gray" };

  return (
    <header style={{
      borderBottom: "1px solid var(--border)",
      background: "var(--bg-card)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      <div style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0 24px",
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}>

        {/* Logo — AgentBazaar style: icon + name */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontWeight: 800,
            fontSize: 15,
            letterSpacing: "-0.04em",
            color: "var(--text-primary)",
          }}>
            + ALPHATRADE
          </span>
        </div>

        {/* Numbered nav — AgentBazaar style */}
        <nav style={{ display: "flex", gap: 0, alignItems: "center" }}>
          {[
            { num: "01", label: "PLATFORM", href: "#" },
            { num: "02", label: "DOCS",     href: "#" },
            { num: "03", label: "GITHUB",   href: "https://github.com" },
          ].map(link => (
            <a
              key={link.label}
              href={link.href}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                color: "var(--text-tertiary)",
                textDecoration: "none",
                padding: "6px 14px",
                transition: "color 0.15s",
                fontWeight: 600,
                letterSpacing: "0.01em",
              }}
              onMouseOver={e => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseOut={e => (e.currentTarget.style.color = "var(--text-tertiary)")}
            >
              <span style={{ fontSize: 9, color: "var(--text-disabled)", fontWeight: 500 }}>{link.num}</span>
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right: network + wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Network badge */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-sm)",
            background: "var(--bg-raised)",
            fontSize: 12,
            color: "var(--text-secondary)",
            fontWeight: 500,
          }}>
            <span className={`dot ${net.dot}`} />
            {net.label}
          </div>

          {/* Wallet — AgentBazaar style: black pill button */}
          <button
            className={`btn ${wallet ? "btn-ghost" : "btn-primary"} btn-sm`}
            onClick={connect}
            id="wallet-connect-btn"
          >
            {wallet ? (
              <span className="mono" style={{ fontSize: 11 }}>
                {wallet.slice(0, 6)}…{wallet.slice(-4)}
              </span>
            ) : (
              <>Connect Wallet ↗</>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
