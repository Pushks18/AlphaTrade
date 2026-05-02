// Anvil deterministic addresses (fresh anvil run)
export const ANVIL_ADDRESSES = {
  GPUMarketplace:     "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  ModelNFT:           "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  ModelMarketplace:   "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  MetaAgentRegistry:  "",
  KeeperHub:          "",
  MockUSDC:           "",
};

// Ethereum Sepolia live addresses
export const SEPOLIA_ADDRESSES = {
  GPUMarketplace:     "0xefE063A1876Bf0FB4Bb8BF1566A5B74B000f4654",
  ModelNFT:           "0x7695a2e4D5314116F543a89CF6eF74084aa5d0d9",
  ModelMarketplace:   "0xF602913E809140B9D067caEEAF37Df0Bdd9db806",
  // Plan 2 — deployed 2026-05-01
  MetaAgentRegistry:  "0x7EE3d703B7304909a9Ecee8eE98DbacA0556A8F5",
  KeeperHub:          "0xbC8c435B2343493693f09b9E3e65D8141D69499d",
  MockUSDC:           "0x5aC67ADcd97E0390c66eB8a52305dC13D05103e5",
};

export const GPU_MARKETPLACE_ABI = [
  "function listGPU(string metadata, uint256 pricePerHour) external returns (uint256)",
  "function rentGPU(uint256 gpuId, uint256 duration) external payable returns (uint256)",
  "function completeJob(uint256 jobId) external",
  "function cancelJob(uint256 jobId) external",
  "function startJob(uint256 jobId) external",
  "function setModelNFT(address newModelNFT) external",
  "function getGPU(uint256 gpuId) external view returns (tuple(address provider, uint256 pricePerHour, string metadata, bool available))",
  "function getJob(uint256 jobId) external view returns (tuple(address renter, uint256 gpuId, uint256 duration, uint256 totalCost, uint8 status))",
  "function jobOwner(uint256 jobId) external view returns (address)",
  "function jobCompleted(uint256 jobId) external view returns (bool)",
  "function modelMinted(uint256 jobId) external view returns (bool)",
  "function nextGpuId() external view returns (uint256)",
  "function nextJobId() external view returns (uint256)",
  "function modelNFT() external view returns (address)",
  "function isJobActive(uint256 jobId) external view returns (bool)",
  "event GPUListed(uint256 indexed gpuId, address indexed provider, uint256 pricePerHour, string metadata)",
  "event JobCreated(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId, uint256 duration, uint256 totalCost)",
  "event JobCompleted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId)",
];

export const MODEL_NFT_ABI = [
  "function mintModel(uint256 jobId, string modelCID, string proofCID, string description) external returns (uint256)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function creator(uint256 tokenId) external view returns (address)",
  "function performanceScore(uint256 tokenId) external view returns (uint256)",
  "function jobIdOfToken(uint256 tokenId) external view returns (uint256)",
  "function tokenIdForJob(uint256 jobId) external view returns (uint256)",
  "function nextTokenId() external view returns (uint256)",
  "function approve(address to, uint256 tokenId) external",
  "event ModelMinted(uint256 indexed tokenId, uint256 indexed jobId, address indexed creator, string modelCID, string proofCID)",
];

export const MODEL_MARKETPLACE_ABI = [
  "function listModel(uint256 tokenId, uint256 price) external",
  "function buyModel(uint256 tokenId) external payable",
  "function cancelListing(uint256 tokenId) external",
  "function updatePrice(uint256 tokenId, uint256 newPrice) external",
  "function listings(uint256 tokenId) external view returns (uint256, address, uint256, bool)",
  "function getActiveListings(uint256[] tokenIds) external view returns (tuple(uint256 tokenId, address seller, uint256 price, bool active)[])",
  "function feeBps() external view returns (uint256)",
  "function royaltyBps() external view returns (uint256)",
  "event ModelListed(uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event ModelSold(uint256 indexed tokenId, address indexed buyer, uint256 price, uint256 sellerAmount, uint256 royalty, uint256 fee)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function mint(address to, uint256 amount) external",
];

export const META_AGENT_REGISTRY_ABI = [
  "function nextAgentId() external view returns (uint256)",
  "function vaultOf(uint256 agentId) external view returns (address)",
  "function usdc() external view returns (address)",
  "function keeperHub() external view returns (address)",
  "function deploy(uint16 perfFeeBps, bytes32 policyHash) external returns (uint256)",
  "event AgentDeployed(uint256 indexed agentId, address indexed operator, address vault, uint16 perfFeeBps)",
];

export const META_AGENT_VAULT_ABI = [
  "function totalAssets() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function asset() external view returns (address)",
  "function vaultId() external view returns (uint256)",
  "function perfFeeBps() external view returns (uint256)",
  "function policyHash() external view returns (bytes32)",
  "function lastHarvestAssets() external view returns (uint256)",
  "function registry() external view returns (address)",
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
  "function harvest() external",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event Harvested(uint256 nav, uint256 gain, uint256 feeShares)",
];

export function getAddresses(chainId: number) {
  if (chainId === 31337) return ANVIL_ADDRESSES;
  if (chainId === 11155111) return SEPOLIA_ADDRESSES;
  return ANVIL_ADDRESSES; // default
}
