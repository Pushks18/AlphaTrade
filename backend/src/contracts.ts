/**
 * contracts.ts — shared ABI + address resolution for the backend.
 * Mirrors frontend/app/lib/contracts.ts (keep in sync).
 */

export const ANVIL_ADDRESSES = {
  GPUMarketplace:   process.env.GPU_MARKETPLACE_ADDRESS  ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  ModelNFT:         process.env.MODEL_NFT_ADDRESS        ?? "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  ModelMarketplace: process.env.MODEL_MARKETPLACE_ADDRESS ?? "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
};

export const GPU_MARKETPLACE_ABI = [
  "event JobCreated(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId, uint256 duration, uint256 totalCost)",
  "event JobCompleted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId)",
  "function getJob(uint256 jobId) external view returns (tuple(address renter, uint256 gpuId, uint256 duration, uint256 totalCost, uint8 status))",
  "function jobCompleted(uint256 jobId) external view returns (bool)",
  "function modelMinted(uint256 jobId) external view returns (bool)",
  "function jobOwner(uint256 jobId) external view returns (address)",
  "function completeJob(uint256 jobId) external",
  "function startJob(uint256 jobId) external",
];

export const MODEL_NFT_ABI = [
  "function mintModel(uint256 jobId, string modelCID, string proofCID, string description) external returns (uint256)",
  "function tokenIdForJob(uint256 jobId) external view returns (uint256)",
  "event ModelMinted(uint256 indexed tokenId, uint256 indexed jobId, address indexed creator, string modelCID, string proofCID)",
];
