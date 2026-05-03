import { ethers } from "ethers";

// AlphaTrade-specific text record keys (per ENS / EIP-634).
// Reading these keys off any ENS name reveals the vault's verifiable
// on-chain identity: which model NFT it runs, which zk proof attests
// to that model, and the latest oracle-verified Sharpe ratio.
export const ENS_KEYS = {
  description:  "description",
  avatar:       "avatar",
  twitter:      "com.twitter",
  url:          "url",
  vault:        "eth.alphatrade.vault",     // address of the MetaAgentVault
  modelNftId:   "eth.alphatrade.modelnft",  // tokenId of the ModelNFT this vault uses
  sharpe:       "eth.alphatrade.sharpe",    // Sharpe ratio in bps from PerformanceOracle
  proofCid:     "eth.alphatrade.proofcid",  // 0G/IPFS CID of the EZKL proof
  policyHash:   "eth.alphatrade.policyhash",
} as const;

const LS_KEY = "alphatrade.ens.bindings.v1";

// Persisted vault → ENS name mapping (browser-local).
// Each user can bind their own vaults to ENS names they own.
export function loadBindings(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
export function saveBinding(vault: string, ensName: string) {
  const all = loadBindings();
  all[vault.toLowerCase()] = ensName.toLowerCase();
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}
export function getBoundName(vault: string): string | null {
  return loadBindings()[vault.toLowerCase()] ?? null;
}

// Mainnet ENS works against any provider; Sepolia uses a public registry too.
// We always resolve against the connected provider — ethers picks the right
// registry per chainId automatically.
export async function lookupAddress(provider: ethers.AbstractProvider, addr: string): Promise<string | null> {
  try { return await provider.lookupAddress(addr); } catch { return null; }
}

export async function getRecords(provider: ethers.AbstractProvider, name: string, keys: string[]): Promise<Record<string, string>> {
  try {
    const resolver = await provider.getResolver(name);
    if (!resolver) return {};
    const out: Record<string, string> = {};
    await Promise.all(keys.map(async k => {
      try {
        const v = await resolver.getText(k);
        if (v) out[k] = v;
      } catch {}
    }));
    return out;
  } catch { return {}; }
}

// ENS PublicResolver setText calldata. We call this directly on the
// resolver address (the user's existing setup) — no NameWrapper required.
const RESOLVER_ABI = [
  "function setText(bytes32 node, string key, string value) external",
];

export async function setRecords(
  signer: ethers.Signer,
  provider: ethers.AbstractProvider,
  name: string,
  records: Array<[string, string]>,
): Promise<{ hash: string; resolver: string } | null> {
  const resolver = await provider.getResolver(name);
  if (!resolver) throw new Error(`No resolver for ${name}`);
  const node = ethers.namehash(name);
  const c = new ethers.Contract(resolver.address, RESOLVER_ABI, signer);
  // Send sequential txs — ENS resolvers don't generally batch setText.
  let lastHash = "";
  for (const [key, value] of records) {
    const tx = await c.setText(node, key, value);
    lastHash = tx.hash;
    await tx.wait();
  }
  return { hash: lastHash, resolver: resolver.address };
}
