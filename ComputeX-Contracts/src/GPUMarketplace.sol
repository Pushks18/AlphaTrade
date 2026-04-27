// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  GPUMarketplace
/// @notice Onchain registry + escrow for GPU compute jobs.
///
///         Flow:
///           1. Provider calls `listGPU` to advertise hardware + hourly rate.
///           2. Renter calls `rentGPU` with `msg.value == pricePerHour * duration`;
///              funds are escrowed in this contract and a `Job` is created.
///           3. Off-chain orchestrator runs the training, generates a zkML proof,
///              uploads weights + proof to 0G Storage.
///           4. Provider (or contract owner) calls `completeJob`. Escrow is paid
///              out, `jobCompleted[jobId]` flips to true, and the GPU is freed.
///              The backend listens for `JobCompleted` and mints the ModelNFT,
///              gating on `jobCompleted[jobId]` + `jobOwner[jobId]`.
///           5. If the provider never delivers, the renter can `cancelJob` for a
///              full refund as long as the job has not completed yet.
contract GPUMarketplace is Ownable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum JobStatus {
        Created,
        Running,
        Completed,
        Cancelled
    }

    struct GPU {
        address provider;
        uint256 pricePerHour;   // wei per hour
        string  metadata;       // off-chain pointer (0G/IPFS) describing specs
        bool    available;      // false while a job is in progress
    }

    struct Job {
        address renter;
        uint256 gpuId;
        uint256 duration;       // hours rented
        uint256 totalCost;      // wei escrowed (== pricePerHour * duration)
        JobStatus status;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice gpuId => GPU listing.
    mapping(uint256 => GPU) public gpus;

    /// @notice jobId => Job.
    mapping(uint256 => Job) public jobs;

    /// @notice jobId => owner of the resulting model (the renter who paid).
    ///         Used by the off-chain ModelNFT minter.
    mapping(uint256 => address) public jobOwner;

    /// @notice jobId => true once the job has been completed and paid out.
    ///         Mirrors `jobs[jobId].status == Completed` for a single-SLOAD check.
    mapping(uint256 => bool) public jobCompleted;

    /// @notice jobId => true once the corresponding ModelNFT has been minted.
    ///         The off-chain minter calls `markModelMinted(jobId)` immediately
    ///         after a successful mint to prevent duplicate / spoofed models.
    mapping(uint256 => bool) public modelMinted;

    uint256 public nextGpuId;
    uint256 public nextJobId;

    /// @notice Address of the ModelNFT contract allowed to call `consumeMintRight`.
    ///         Set once (or rotated by owner) via `setModelNFT`.
    address public modelNFT;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when a provider lists a new GPU.
    event GPUListed(uint256 indexed gpuId, address indexed provider, uint256 pricePerHour, string metadata);

    /// @notice Emitted when a renter creates a job. Backend parses this to
    ///         dispatch off-chain training.
    event JobCreated(
        uint256 indexed jobId,
        address indexed renter,
        uint256 indexed gpuId,
        uint256 duration,
        uint256 totalCost
    );

    /// @notice Emitted when escrow is released to the provider. Backend parses
    ///         this to mint the ModelNFT for `renter`.
    event JobCompleted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId);

    /// @notice Emitted when the orchestrator flips a job from Created to Running.
    event JobStarted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId);

    /// @notice Emitted when the renter cancels and is refunded.
    event JobCancelled(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId, uint256 refund);

    /// @notice Emitted when the ModelNFT contract atomically claims a job's mint right.
    event ModelMintedMarked(uint256 indexed jobId);

    /// @notice Emitted when the ModelNFT contract address is set.
    event ModelNFTUpdated(address indexed previousNFT, address indexed newNFT);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Sets (or rotates) the ModelNFT contract authorized to consume
    ///         mint rights produced by completed jobs.
    function setModelNFT(address newModelNFT) external onlyOwner {
        require(newModelNFT != address(0), "GPU: zero address");
        emit ModelNFTUpdated(modelNFT, newModelNFT);
        modelNFT = newModelNFT;
    }

    // ---------------------------------------------------------------------
    // Provider actions
    // ---------------------------------------------------------------------

    /// @notice Register a GPU as available for rent.
    /// @param  metadata     Off-chain URI (0G/IPFS) describing GPU specs.
    /// @param  pricePerHour Wei per hour the provider charges.
    /// @return gpuId        Identifier of the new listing.
    function listGPU(string calldata metadata, uint256 pricePerHour) external returns (uint256 gpuId) {
        require(pricePerHour > 0, "GPU: price=0");
        require(bytes(metadata).length > 0, "GPU: empty metadata");

        gpuId = nextGpuId++;
        gpus[gpuId] = GPU({
            provider: msg.sender,
            pricePerHour: pricePerHour,
            metadata: metadata,
            available: true
        });

        emit GPUListed(gpuId, msg.sender, pricePerHour, metadata);
    }

    // ---------------------------------------------------------------------
    // Renter actions
    // ---------------------------------------------------------------------

    /// @notice Rent a listed GPU for `duration` hours. msg.value is escrowed.
    /// @param  gpuId    Listing to rent.
    /// @param  duration Hours of compute requested (must be > 0).
    /// @return jobId    Identifier of the created job.
    function rentGPU(uint256 gpuId, uint256 duration)
        external
        payable
        nonReentrant
        returns (uint256 jobId)
    {
        GPU storage gpu = gpus[gpuId];
        require(gpu.provider != address(0), "GPU: not found");
        require(gpu.available, "GPU: unavailable");
        require(duration > 0, "GPU: duration=0");
        require(msg.sender != gpu.provider, "GPU: provider cannot rent self");

        uint256 totalCost = gpu.pricePerHour * duration;
        require(msg.value == totalCost, "GPU: bad payment");

        gpu.available = false;

        jobId = nextJobId++;
        jobs[jobId] = Job({
            renter: msg.sender,
            gpuId: gpuId,
            duration: duration,
            totalCost: totalCost,
            status: JobStatus.Created
        });
        jobOwner[jobId] = msg.sender;

        emit JobCreated(jobId, msg.sender, gpuId, duration, totalCost);
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    /// @notice Orchestrator marks a job as actively running off-chain.
    /// @dev    Optional transition (Created -> Running). `completeJob` accepts
    ///         either Created or Running, so backends can skip this if they
    ///         settle in one shot.
    function startJob(uint256 jobId) external onlyOwner {
        Job storage job = jobs[jobId];
        require(job.renter != address(0), "Job: not found");
        require(job.status == JobStatus.Created, "Job: not pending");

        job.status = JobStatus.Running;
        emit JobStarted(jobId, job.renter, job.gpuId);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Complete a job and release escrow to the provider.
    /// @dev    Callable by the GPU's provider or by the contract owner. The
    ///         owner path lets a privileged orchestrator settle disputes /
    ///         finalize jobs once a zkML proof has been verified off-chain.
    function completeJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.renter != address(0), "Job: not found");
        require(job.status == JobStatus.Created || job.status == JobStatus.Running, "Job: not active");

        GPU storage gpu = gpus[job.gpuId];
        require(msg.sender == gpu.provider || msg.sender == owner(), "Job: not authorized");

        // Effects (state updated before external transfer to block reentry).
        job.status = JobStatus.Completed;
        jobCompleted[jobId] = true;
        gpu.available = true;

        uint256 payout = job.totalCost;
        address provider = gpu.provider;

        // Interaction.
        (bool ok, ) = payable(provider).call{value: payout}("");
        require(ok, "Job: payout failed");

        emit JobCompleted(jobId, job.renter, job.gpuId);
    }

    /// @notice Renter cancels an unfinished job and reclaims their escrow.
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.renter != address(0), "Job: not found");
        require(msg.sender == job.renter, "Job: only renter");
        require(job.status != JobStatus.Completed, "Job: already completed");
        require(job.status != JobStatus.Cancelled, "Job: already cancelled");

        // Effects.
        job.status = JobStatus.Cancelled;
        gpus[job.gpuId].available = true;
        uint256 refund = job.totalCost;

        // Interaction.
        (bool ok, ) = payable(job.renter).call{value: refund}("");
        require(ok, "Job: refund failed");

        emit JobCancelled(jobId, job.renter, job.gpuId, refund);
    }

    // ---------------------------------------------------------------------
    // Model linkage
    // ---------------------------------------------------------------------

    /// @notice Atomically claims the right to mint a ModelNFT for `jobId`.
    /// @dev    Callable only by the registered ModelNFT contract. Returns the
    ///         renter (= rightful model owner) and flips `modelMinted[jobId]`,
    ///         giving a single-call, race-free mint pipeline:
    ///
    ///             ModelNFT.mintModel(jobId, ...) -->
    ///                 GPUMarketplace.consumeMintRight(jobId) -->
    ///                     _safeMint(owner, tokenId)
    ///
    ///         Any subsequent attempt to mint for the same job reverts here.
    function consumeMintRight(uint256 jobId) external returns (address) {
        require(msg.sender == modelNFT, "GPU: not modelNFT");
        require(jobCompleted[jobId], "Job: not completed");
        require(!modelMinted[jobId], "Job: model already minted");

        modelMinted[jobId] = true;
        emit ModelMintedMarked(jobId);

        return jobOwner[jobId];
    }

    // ---------------------------------------------------------------------
    // Views (frontend + backend integration)
    // ---------------------------------------------------------------------

    /// @notice Returns the full GPU listing struct for a given id.
    function getGPU(uint256 gpuId) external view returns (GPU memory) {
        return gpus[gpuId];
    }

    /// @notice Returns the full Job struct for a given id.
    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    /// @notice Convenience: returns the provider that owns the GPU backing a job.
    /// @dev    Saves backends from doing nested struct decoding.
    function getJobProvider(uint256 jobId) external view returns (address) {
        return gpus[jobs[jobId].gpuId].provider;
    }

    /// @notice True if the job is in Created or Running state (escrow live).
    function isJobActive(uint256 jobId) public view returns (bool) {
        JobStatus s = jobs[jobId].status;
        return s == JobStatus.Created || s == JobStatus.Running;
    }
}
