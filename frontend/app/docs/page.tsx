"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

interface Section { id: string; label: string; }
interface Group   { title: string; items: Section[]; }

const NAV: Group[] = [
  {
    title: "Getting Started",
    items: [
      { id: "overview",      label: "Overview" },
      { id: "quick-start",   label: "Quick Start (Local)" },
      { id: "test-flow",     label: "Testing the Full Flow" },
    ],
  },
  {
    title: "Architecture",
    items: [
      { id: "stack",         label: "The Stack" },
      { id: "contracts",     label: "Smart Contracts" },
      { id: "zkml",          label: "zkML Pipeline" },
      { id: "meta-agents",   label: "Meta-Agents" },
    ],
  },
  {
    title: "Setup",
    items: [
      { id: "prereqs",       label: "Prerequisites" },
      { id: "install",       label: "Installation" },
      { id: "deploy-local",  label: "Deploy Locally (Anvil)" },
      { id: "deploy-sepolia",label: "Deploy to Sepolia" },
      { id: "metamask",      label: "MetaMask Setup" },
    ],
  },
  {
    title: "Guides",
    items: [
      { id: "list-rent-gpu",  label: "List & Rent a GPU" },
      { id: "mint-trade-nft", label: "Mint & Trade Model NFT" },
      { id: "deploy-vault",   label: "Deploy a Meta-Agent Vault" },
      { id: "run-runtime",    label: "Run the Python Runtime" },
    ],
  },
  {
    title: "Reference",
    items: [
      { id: "contract-addrs", label: "Contract Addresses" },
      { id: "events",         label: "Events" },
      { id: "errors",         label: "Common Errors" },
    ],
  },
];

export default function DocsPage() {
  const [active, setActive] = useState<string>("overview");

  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: "-20% 0px -75% 0px" });
    NAV.flatMap(g => g.items).forEach(s => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Topbar */}
      <header style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
        padding: "12px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ textDecoration: "none", color: "var(--text-primary)", fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em" }}>
            + ALPHATRADE
          </Link>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Documentation</span>
        </div>
        <Link href="/" style={{ fontSize: 12, color: "var(--blue)", textDecoration: "none" }}>← Back to App</Link>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 200px", maxWidth: 1280, margin: "0 auto", gap: 0 }}>

        {/* ── Left sidebar ── */}
        <aside style={{
          position: "sticky", top: 53, alignSelf: "flex-start",
          height: "calc(100vh - 53px)", overflowY: "auto",
          padding: "24px 16px", borderRight: "1px solid var(--border)",
        }}>
          {NAV.map(g => (
            <div key={g.title} style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.08em", marginBottom: 8, textTransform: "uppercase" }}>
                {g.title}
              </div>
              {g.items.map(s => (
                <a key={s.id} href={`#${s.id}`}
                  style={{
                    display: "block", padding: "5px 10px", fontSize: 13,
                    color: active === s.id ? "var(--blue)" : "var(--text-secondary)",
                    background: active === s.id ? "var(--blue-dim)" : "transparent",
                    borderRadius: 4, textDecoration: "none", marginBottom: 1,
                    fontWeight: active === s.id ? 600 : 400,
                  }}>
                  {s.label}
                </a>
              ))}
            </div>
          ))}
        </aside>

        {/* ── Main content ── */}
        <main style={{ padding: "32px 40px", maxWidth: 760, lineHeight: 1.65 }}>

          <Section id="overview" h="Overview">
            <p>
              <strong>AlphaTrade</strong> is a decentralized GPU compute and AI-trading-model marketplace. The system has five layers, all in this repo:
            </p>
            <ol>
              <li><strong>GPU Marketplace</strong> — providers list rigs, users rent and escrow ETH</li>
              <li><strong>Model NFTs (ERC-7857)</strong> — trained AI models tokenized with zkML proofs</li>
              <li><strong>Performance Oracle</strong> — verifies SNARK proofs and recomputes Sharpe on-chain</li>
              <li><strong>Meta-Agent Vaults (ERC-4626)</strong> — autonomous trading bots that own model NFTs and rebalance a basket on Uniswap V3</li>
              <li><strong>Frontend</strong> — Next.js 14 dApp covering all five tabs</li>
            </ol>
            <p>
              Built for ETHGlobal Open Agents (approach C). Single-developer scope; all layers in one repo.
            </p>
            <Callout type="info">
              <strong>The hackathon novelty:</strong> meta-agents read the trained model NFTs on-chain and use them to drive real trading capital. Models compete for capital flow, creators earn royalties, depositors track NAV — full economic loop.
            </Callout>
          </Section>

          <Section id="quick-start" h="Quick Start (Local)">
            <p>You need <strong>three terminals</strong>. After this you'll have a fully working dApp on Anvil.</p>
            <Step n={1} title="Start Anvil">
              <Code lang="bash">{`cd /Users/pushkaraj/Documents/AlphaTrade/ComputeX-Contracts
anvil`}</Code>
              <p style={{ fontSize: 12 }}>Note the 10 funded accounts and their private keys — you'll import a few into MetaMask.</p>
            </Step>
            <Step n={2} title="Deploy Plan 1 (core contracts)">
              <Code lang="bash">{`# In a new terminal:
cd /Users/pushkaraj/Documents/AlphaTrade/ComputeX-Contracts
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export RPC_URL=http://127.0.0.1:8545
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast`}</Code>
            </Step>
            <Step n={3} title="Deploy Plan 2 (meta-agent contracts)">
              <Code lang="bash">{`forge script script/DeployMetaAgentLocal.s.sol:DeployMetaAgentLocal --rpc-url $RPC_URL --broadcast`}</Code>
              <p style={{ fontSize: 12 }}>Uses MockTradingExecutor (1:1 swaps) since Anvil has no real Uniswap deployment.</p>
            </Step>
            <Step n={4} title="Start the frontend">
              <Code lang="bash">{`cd ../frontend
npm install   # only first time
npm run dev   # serves on http://localhost:3000`}</Code>
            </Step>
            <Step n={5} title="Connect MetaMask">
              <p>Add a network with <strong>RPC: http://127.0.0.1:8545</strong>, <strong>Chain ID: 31337</strong>, <strong>Symbol: ETH</strong>. Import any Anvil account's private key (account 0 is the standard one).</p>
            </Step>
          </Section>

          <Section id="test-flow" h="Testing the Full Flow">
            <p>The full loop uses three Anvil accounts. Each row below is one MetaMask account switch.</p>
            <table className="docs-table">
              <thead>
                <tr><th>Step</th><th>Account</th><th>Tab</th><th>Action</th></tr>
              </thead>
              <tbody>
                <tr><td>1</td><td>Acc 0 — provider</td><td>01 GPU Market</td><td>List a GPU</td></tr>
                <tr><td>2</td><td>Acc 1 — renter</td><td>02 Compute Jobs</td><td>Rent the GPU</td></tr>
                <tr><td>3</td><td>Acc 0 — provider</td><td>02 Compute Jobs</td><td>Complete Job (releases escrow)</td></tr>
                <tr><td>4</td><td>Acc 1 — renter</td><td>03 Model NFTs</td><td>Mint NFT (with 0.01 ETH stake)</td></tr>
                <tr><td>5</td><td>Acc 1</td><td>04 Trade</td><td>List NFT for sale</td></tr>
                <tr><td>6</td><td>Acc 2 — buyer</td><td>04 Trade</td><td>Buy NFT</td></tr>
                <tr><td>7</td><td>Any acc</td><td>05 Meta-Agents</td><td>Deploy vault, mint USDC, deposit</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="stack" h="The Stack">
            <Pill list={["Foundry", "Solidity 0.8.20", "OpenZeppelin v5.0.2", "Next.js 14", "React 18", "ethers v6", "Python 3.12", "PyTorch", "EZKL (Halo2)", "Uniswap V3"]} />
            <p><strong>Why these choices:</strong></p>
            <ul>
              <li>Foundry over Hardhat — faster tests, native fuzzing, simpler scripts</li>
              <li>OZ v5.0.2 pinned — v5.6+ requires solc 0.8.24 which breaks Foundry's default toolchain</li>
              <li>EZKL Halo2 over Risc0/SP1 — smaller proofs (~29 KB) and ~38s prove time on M1</li>
              <li>ERC-4626 for vaults — battle-tested deposit/redeem accounting</li>
            </ul>
          </Section>

          <Section id="contracts" h="Smart Contracts">
            <ContractCard
              name="GPUMarketplace"
              what="GPU rental market with escrowed ETH and one-shot mint rights per completed job."
              key_methods={["listGPU", "rentGPU", "completeJob", "consumeMintRight (gated to ModelNFT)"]}
            />
            <ContractCard
              name="ModelNFT (ERC-721)"
              what="Tokenized AI models. Payable mint with creator stake. Slashable by oracle."
              key_methods={["mintModel", "setPerformanceScore (oracle-gated)", "slashStake (oracle-gated)"]}
            />
            <ContractCard
              name="ModelMarketplace"
              what="Fixed-price NFT marketplace. 5% royalty + 2.5% fee. Holds zero ETH between txs."
              key_methods={["listModel", "buyModel", "cancelListing", "updatePrice"]}
            />
            <ContractCard
              name="PerformanceOracle"
              what="Verifies Halo2 SNARKs, checks signed price feed, recomputes Sharpe in bps on-chain."
              key_methods={["publishFeedRoot", "submitAudit", "slash"]}
            />
            <ContractCard
              name="CreatorRegistry (Soulbound)"
              what="Permanent reputation SBT. Records every mint/score/slash. Non-transferable."
              key_methods={["recordMint", "recordScore", "recordSlash"]}
            />
            <ContractCard
              name="MetaAgentRegistry (ERC-721)"
              what="Operator-NFT factory. deploy() spawns a new vault and mints the operator NFT."
              key_methods={["deploy(perfFeeBps, policyHash)", "vaultOf(agentId)"]}
            />
            <ContractCard
              name="MetaAgentVault (ERC-4626)"
              what="Per-agent USDC vault. Operator runs Python bot to call executeTrade hourly."
              key_methods={["deposit", "redeem", "depositModel", "executeTrade", "harvest"]}
            />
            <ContractCard
              name="TradingExecutor"
              what="Wraps Uniswap V3 router. Vault calls executeSwaps via this for routing + price reads."
              key_methods={["executeSwaps", "priceOf", "registerVault"]}
            />
          </Section>

          <Section id="zkml" h="zkML Pipeline">
            <p>The off-chain pipeline lives in <code>backend/zkml/</code>:</p>
            <ul>
              <li><code>model.py</code> — AlphaMLP: 120→32→16→5 ReLU+softmax, ~3.4k params</li>
              <li><code>train.py</code> — PyTorch trainer, exports ONNX, deterministic SHA3 weights hash</li>
              <li><code>oracle_feed.py</code> — generates GBM price feed, builds sorted-pair Merkle tree, signs root</li>
              <li><code>backtest.py</code> + <code>sharpe.py</code> — bit-exact Sharpe-bps parity with Solidity <code>_isqrt</code></li>
              <li><code>prove.py</code> — full EZKL Halo2 pipeline (gen_settings → calibrate → compile → witness → setup → prove → EVM verifier)</li>
            </ul>
            <Callout type="warn">
              <strong>Known limitations (v2 follow-ups):</strong> auto-generated Halo2Verifier expects raw I/O samples as public inputs but the contract requires hashes; Merkle verifier is single-sibling so only works for 2-leaf trees; macOS arm64 has an SRS bug — run prove.py on x86 Linux for production.
            </Callout>
          </Section>

          <Section id="meta-agents" h="Meta-Agents">
            <p>A meta-agent is a <strong>fund + bot</strong> pair:</p>
            <ul>
              <li><strong>On-chain:</strong> a <code>MetaAgentVault</code> holding USDC and a basket of 5 tokens</li>
              <li><strong>Off-chain:</strong> a Python runtime (<code>backend/meta_agent/runtime.py</code>) that:
                <ul>
                  <li>Listens for <code>AuditAccepted</code> events from the oracle</li>
                  <li>Runs an EXP4 contextual bandit over eligible model NFTs</li>
                  <li>Aggregates ONNX inference outputs into target weights</li>
                  <li>Signs and submits <code>executeTrade(uint16[5] weights, blockNumber, sig)</code></li>
                </ul>
              </li>
            </ul>
            <p>The operator is whoever holds the agentId NFT in <code>MetaAgentRegistry</code>. They earn the perf fee on harvest. Depositors track the NAV.</p>
          </Section>

          <Section id="prereqs" h="Prerequisites">
            <ul>
              <li><strong>Foundry</strong> — install with <Code lang="bash">{`curl -L https://foundry.paradigm.xyz | bash && foundryup`}</Code></li>
              <li><strong>Node.js 20+</strong> and npm</li>
              <li><strong>Python 3.12</strong> (for zkML + meta-agent runtime)</li>
              <li><strong>MetaMask</strong> browser extension</li>
              <li>Optional: <strong>Halo2-compatible Linux box</strong> for prove.py (macOS arm64 has SRS issues)</li>
            </ul>
          </Section>

          <Section id="install" h="Installation">
            <Code lang="bash">{`git clone <repo> AlphaTrade
cd AlphaTrade

# Smart contracts
cd ComputeX-Contracts
forge install
forge build

# Frontend
cd ../frontend
npm install

# Backend (zkML + meta-agent)
cd ../backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt`}</Code>
          </Section>

          <Section id="deploy-local" h="Deploy Locally (Anvil)">
            <Code lang="bash">{`# Terminal 1
cd ComputeX-Contracts && anvil

# Terminal 2
cd ComputeX-Contracts
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export RPC_URL=http://127.0.0.1:8545
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast
forge script script/DeployMetaAgentLocal.s.sol:DeployMetaAgentLocal --rpc-url $RPC_URL --broadcast

# Terminal 3
cd frontend && npm run dev`}</Code>
            <p>Anvil addresses are deterministic — they match the values pre-baked into <code>frontend/app/lib/contracts.ts</code>. No copy-paste needed.</p>
          </Section>

          <Section id="deploy-sepolia" h="Deploy to Ethereum Sepolia">
            <p>Plan 1 + Plan 2 contracts are <strong>already live</strong> on Sepolia. To redeploy, fund the deployer with ~0.02 ETH on Sepolia, then:</p>
            <Code lang="bash">{`export PRIVATE_KEY=<your-key>
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast
forge script script/DeployMetaAgent.s.sol:DeployMetaAgent --rpc-url $RPC_URL --broadcast`}</Code>
            <p>The DeployMetaAgent script uses real Uniswap V3 addresses on Sepolia (<code>SwapRouter02 = 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E</code>). Mock USDC/WBTC/LINK/UNI are deployed inline since canonical testnet addresses don't exist.</p>
          </Section>

          <Section id="metamask" h="MetaMask Setup">
            <Step n={1} title="Add Anvil network">
              <ul>
                <li>Network name: <code>Anvil</code></li>
                <li>RPC URL: <code>http://127.0.0.1:8545</code></li>
                <li>Chain ID: <code>31337</code></li>
                <li>Currency symbol: <code>ETH</code> (ignore the GoChain warning — harmless)</li>
              </ul>
            </Step>
            <Step n={2} title="Import three accounts">
              <p>From Anvil's startup output, grab the first 3 private keys and import each as a separate account:</p>
              <ul>
                <li>Acc 0 — provider — <code>0xac09…2ff80</code></li>
                <li>Acc 1 — renter / creator — <code>0x59c6…690d</code></li>
                <li>Acc 2 — buyer / depositor — <code>0x5de4…b365a</code></li>
              </ul>
            </Step>
          </Section>

          <Section id="list-rent-gpu" h="Guide: List & Rent a GPU">
            <Step n={1} title="As Acc 0 (provider) — Tab 01">
              <p>Click <strong>+ List GPU</strong> → fill metadata + price → submit. After tx lands, the table shows your GPU as #0.</p>
            </Step>
            <Step n={2} title="Switch MetaMask to Acc 1 (renter) — Tab 02">
              <p>The gpuId is auto-prefilled. Set duration → click <strong>Rent GPU & Start Job</strong>. Escrow locks <code>price × duration</code> ETH.</p>
            </Step>
            <Step n={3} title="Switch back to Acc 0 (provider) — Tab 02">
              <p>Click <strong>✓ Complete Job (Provider)</strong>. Escrow releases to you. Mint right unlocks for the renter.</p>
            </Step>
          </Section>

          <Section id="mint-trade-nft" h="Guide: Mint & Trade Model NFT">
            <Step n={1} title="As Acc 1 — Tab 03">
              <p>Job ID auto-prefilled. Click <strong>Mint Model NFT</strong>. Sends 0.01 ETH creator stake. Token #1 minted to you.</p>
            </Step>
            <Step n={2} title="As Acc 1 — Tab 04 → Sell">
              <p>Token ID auto-prefilled. Set price (e.g. 0.05 ETH) → <strong>Approve & List</strong> (two transactions: approve + listModel).</p>
            </Step>
            <Step n={3} title="Switch to Acc 2 — Tab 04 → Market">
              <p>Click the listing → <strong>Buy Model NFT</strong>. Pays 0.05 ETH; contract splits 92.5% to seller / 5% royalty to creator / 2.5% fee.</p>
            </Step>
          </Section>

          <Section id="deploy-vault" h="Guide: Deploy a Meta-Agent Vault">
            <Step n={1} title="Tab 05 → Deploy Agent">
              <p>Set perfFeeBps (e.g. 500 for 5%). Click <strong>Deploy Agent Vault</strong>. Spawns ERC-4626 vault, mints you the operator NFT.</p>
            </Step>
            <Step n={2} title="Mint mock USDC">
              <p>Click <strong>Faucet: Mint 1,000 USDC</strong> in the right sidebar. Anvil + Sepolia both support this.</p>
            </Step>
            <Step n={3} title="Deposit">
              <p>Click <strong>Details</strong> on your vault row → see NAV chart, holdings, recent trades. Or click <strong>Deposit</strong> to put USDC in.</p>
            </Step>
          </Section>

          <Section id="run-runtime" h="Guide: Run the Python Runtime">
            <Code lang="bash">{`cd backend
source .venv/bin/activate

# Train a model and export ONNX
python -m zkml.train --job-id 0 --output /tmp/ax_train

# Run the meta-agent runtime
cat > config.json << EOF
{
  "rpc_url": "http://localhost:8545",
  "vault_addr": "<your vault address from Tab 05>",
  "operator_key": "<operator's private key>",
  "oracle_addr": "<PerformanceOracle address>",
  "model_dir": "/tmp/ax_train",
  "tick_seconds": 30,
  "score_threshold_bps": 0
}
EOF

python -m meta_agent.runtime --config config.json`}</Code>
            <p>Every <code>tick_seconds</code>, the bandit picks model NFTs, ONNX inference produces basket weights, the runtime signs and submits <code>executeTrade</code>.</p>
          </Section>

          <Section id="contract-addrs" h="Contract Addresses">
            <h4>Anvil (chain 31337) — deterministic</h4>
            <table className="docs-table">
              <tbody>
                <tr><td>GPUMarketplace</td><td><code>0x5FbDB2315678afecb367f032d93F642f64180aa3</code></td></tr>
                <tr><td>ModelNFT</td><td><code>0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512</code></td></tr>
                <tr><td>ModelMarketplace</td><td><code>0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0</code></td></tr>
                <tr><td>MetaAgentRegistry</td><td><code>0x0B306BF915C4d645ff596e518fAf3F9669b97016</code></td></tr>
                <tr><td>MockTradingExecutor</td><td><code>0x9A676e781A523b5d0C0e43731313A708CB607508</code></td></tr>
                <tr><td>MockUSDC</td><td><code>0x8A791620dd6260079BF849Dc5567aDC3F2FdC318</code></td></tr>
              </tbody>
            </table>
            <h4 style={{ marginTop: 18 }}>Ethereum Sepolia (chain 11155111) — live</h4>
            <table className="docs-table">
              <tbody>
                <tr><td>GPUMarketplace</td><td><code>0xefE063A1876Bf0FB4Bb8BF1566A5B74B000f4654</code></td></tr>
                <tr><td>ModelNFT</td><td><code>0x7695a2e4D5314116F543a89CF6eF74084aa5d0d9</code></td></tr>
                <tr><td>ModelMarketplace</td><td><code>0xF602913E809140B9D067caEEAF37Df0Bdd9db806</code></td></tr>
                <tr><td>MetaAgentRegistry</td><td><code>0x7EE3d703B7304909a9Ecee8eE98DbacA0556A8F5</code></td></tr>
                <tr><td>TradingExecutor</td><td><code>0xbC8c435B2343493693f09b9E3e65D8141D69499d</code></td></tr>
                <tr><td>MockUSDC</td><td><code>0x5aC67ADcd97E0390c66eB8a52305dC13D05103e5</code></td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="events" h="Key Events">
            <Code lang="solidity">{`// GPUMarketplace
event GPUListed(uint256 indexed gpuId, address indexed provider, uint256 pricePerHour, string metadata);
event JobCreated(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId, uint256 duration, uint256 totalCost);
event JobCompleted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId);

// ModelNFT
event ModelMinted(uint256 indexed tokenId, uint256 indexed jobId, address indexed creator, string modelCID, string proofCID);
event PerformanceScoreUpdated(uint256 indexed tokenId, uint256 score, uint256 sharpeBps);

// PerformanceOracle
event AuditAccepted(uint256 indexed tokenId, uint256 indexed epoch, uint256 sharpeBps, uint256 nTrades);

// MetaAgentVault
event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
event TradeExecuted(uint256 indexed blockNumber, uint256 navBefore);
event Harvested(uint256 nav, uint256 gain, uint256 feeShares);`}</Code>
          </Section>

          <Section id="errors" h="Common Errors">
            <ErrorRow err='"GPU: provider cannot rent self"' fix="Switch to a different MetaMask account (not the one that listed the GPU)." />
            <ErrorRow err='"Job: not authorized"' fix="Only the GPU provider can call completeJob. Switch back to the listing account." />
            <ErrorRow err='"Model: job already minted"' fix="Each completed job produces exactly one NFT. Use a different jobId." />
            <ErrorRow err='ERC20InsufficientBalance' fix="Click the USDC faucet on Tab 05 to mint mock USDC before depositing." />
            <ErrorRow err='"could not decode result data"' fix="The contract you're calling doesn't exist on this network. Switch MetaMask to the right chain." />
            <ErrorRow err='"Malicious address" (Blockaid warning)' fix="You're on Ethereum mainnet — switch to Anvil or Sepolia." />
          </Section>

          <div style={{ marginTop: 64, paddingTop: 32, borderTop: "1px solid var(--border)", color: "var(--text-tertiary)", fontSize: 12 }}>
            Built for ETHGlobal Open Agents · Last updated 2026-05-02
          </div>
        </main>

        {/* ── Right TOC (current section anchors) — kept simple ── */}
        <aside style={{ padding: "32px 16px", fontSize: 11 }}>
          <div style={{ position: "sticky", top: 80 }}>
            <div style={{ fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.08em", marginBottom: 8 }}>
              ON THIS PAGE
            </div>
            <div style={{ color: "var(--text-secondary)", lineHeight: 1.8 }}>
              {NAV.flatMap(g => g.items).find(s => s.id === active)?.label || "—"}
            </div>
          </div>
        </aside>
      </div>

      <style>{`
        main h2 { font-size: 24px; font-weight: 800; margin-top: 40px; margin-bottom: 12px; letter-spacing: -0.02em; scroll-margin-top: 80px; }
        main h3 { font-size: 18px; font-weight: 700; margin-top: 28px; margin-bottom: 10px; }
        main h4 { font-size: 14px; font-weight: 700; margin-top: 14px; margin-bottom: 8px; color: var(--text-secondary); }
        main p { margin-bottom: 12px; color: var(--text-secondary); }
        main ul, main ol { padding-left: 24px; margin-bottom: 14px; color: var(--text-secondary); }
        main li { margin-bottom: 4px; }
        main code { background: var(--bg-muted); padding: 1px 6px; border-radius: 3px; font-size: 12.5px; font-family: "JetBrains Mono", monospace; color: var(--text-primary); }
        .docs-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        .docs-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 11px; color: var(--text-tertiary); letter-spacing: 0.05em; text-transform: uppercase; }
        .docs-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--text-primary); }
        .docs-table td code { font-size: 11px; }
      `}</style>
    </div>
  );
}

function Section({ id, h, children }: { id: string; h: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 32 }}>
      <h2>{h}</h2>
      {children}
    </section>
  );
}

function Code({ lang, children }: { lang: string; children: string }) {
  return (
    <pre style={{
      background: "#1a1a1a", color: "#f4f4f5",
      padding: "14px 16px", borderRadius: 6, overflowX: "auto",
      fontSize: 12.5, lineHeight: 1.55, margin: "10px 0",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ fontSize: 10, color: "#71717a", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{lang}</div>
      <code>{children}</code>
    </pre>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
        background: "var(--text-primary)", color: "var(--bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 13,
      }}>{n}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "var(--text-primary)" }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Pill({ list }: { list: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
      {list.map(t => (
        <span key={t} style={{
          padding: "4px 10px", fontSize: 11, fontWeight: 600,
          background: "var(--bg-muted)", color: "var(--text-secondary)",
          borderRadius: 4,
        }}>{t}</span>
      ))}
    </div>
  );
}

function Callout({ type, children }: { type: "info" | "warn"; children: React.ReactNode }) {
  const colors = type === "warn"
    ? { bg: "rgba(234,88,12,0.07)", border: "rgba(234,88,12,0.18)", text: "var(--orange)" }
    : { bg: "var(--blue-dim)", border: "var(--blue-border)", text: "var(--blue)" };
  return (
    <div style={{
      padding: "12px 14px", borderLeft: `3px solid ${colors.text}`,
      background: colors.bg, borderRadius: "0 4px 4px 0",
      margin: "14px 0", fontSize: 13, lineHeight: 1.6,
    }}>
      {children}
    </div>
  );
}

function ContractCard({ name, what, key_methods }: { name: string; what: string; key_methods: string[] }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>{name}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 8 }}>{what}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {key_methods.map(m => (
          <span key={m} style={{ padding: "2px 6px", fontSize: 10, background: "var(--bg-muted)", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace" }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

function ErrorRow({ err, fix }: { err: string; fix: string }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--red)", marginBottom: 4 }}>{err}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{fix}</div>
    </div>
  );
}
