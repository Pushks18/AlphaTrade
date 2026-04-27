// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal view into ModelNFT — only the creator() mapping getter.
interface IModelNFTCreator {
    function creator(uint256 tokenId) external view returns (address);
}

/// @title  ModelMarketplace
/// @notice Fixed-price secondary marketplace for ModelNFT tokens.
///
///         Each sale splits ETH three ways:
///             - protocol fee     → feeRecipient (`feeBps` bps)
///             - creator royalty  → ModelNFT.creator(tokenId) (`royaltyBps` bps)
///             - remainder        → seller
///
///         No protocol custody beyond active escrow: the contract holds the
///         listed NFT and zero ETH between transactions.
contract ModelMarketplace is Ownable, ReentrancyGuard, IERC721Receiver {
    // ---------------------------------------------------------------------
    // Custom errors (gas + readability)
    // ---------------------------------------------------------------------

    error NotOwner();
    error NotSeller();
    error NotActive();
    error InvalidPrice();
    error InvalidPayment();
    error AlreadyListed();
    error SelfTrade();
    error TransferFailed();
    error ZeroAddress();
    error BpsTooHigh();

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Listing {
        uint256 tokenId;
        address seller;
        uint256 price;     // wei
        bool    active;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE_BPS = 1_000;       // 10% cap
    uint256 public constant MAX_ROYALTY_BPS = 1_000;   // 10% cap

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The ModelNFT contract whose tokens trade here.
    address public immutable modelNFT;

    /// @notice tokenId => Listing.
    mapping(uint256 => Listing) public listings;

    /// @notice Protocol fee in basis points (250 = 2.5%).
    uint256 public feeBps = 250;

    /// @notice Creator royalty in basis points (500 = 5%).
    uint256 public royaltyBps = 500;

    /// @notice Recipient of protocol fees.
    address public feeRecipient;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ModelListed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event ModelSold(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 price,
        uint256 sellerAmount,
        uint256 royalty,
        uint256 fee
    );
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event PriceUpdated(uint256 indexed tokenId, address indexed seller, uint256 newPrice);

    event FeeBpsUpdated(uint256 previousBps, uint256 newBps);
    event RoyaltyBpsUpdated(uint256 previousBps, uint256 newBps);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address initialOwner, address modelNFTAddress) Ownable(initialOwner) {
        if (modelNFTAddress == address(0)) revert ZeroAddress();
        modelNFT = modelNFTAddress;
        feeRecipient = initialOwner;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setFee(uint256 newBps) external onlyOwner {
        if (newBps > MAX_FEE_BPS) revert BpsTooHigh();
        emit FeeBpsUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    function setRoyaltyBps(uint256 newBps) external onlyOwner {
        if (newBps > MAX_ROYALTY_BPS) revert BpsTooHigh();
        emit RoyaltyBpsUpdated(royaltyBps, newBps);
        royaltyBps = newBps;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    // ---------------------------------------------------------------------
    // Seller actions
    // ---------------------------------------------------------------------

    /// @notice List an owned ModelNFT for sale at a fixed ETH price.
    /// @dev    Seller must `approve` (or `setApprovalForAll`) this contract on
    ///         the ModelNFT first. The token is escrowed on success.
    function listModel(uint256 tokenId, uint256 price) external {
        if (price == 0) revert InvalidPrice();
        if (listings[tokenId].active) revert AlreadyListed();

        IERC721 nft = IERC721(modelNFT);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();

        listings[tokenId] = Listing({
            tokenId: tokenId,
            seller: msg.sender,
            price: price,
            active: true
        });

        emit ModelListed(tokenId, msg.sender, price);

        nft.safeTransferFrom(msg.sender, address(this), tokenId);
    }

    /// @notice Update the price of an active listing without re-escrowing.
    function updatePrice(uint256 tokenId, uint256 newPrice) external {
        Listing storage l = listings[tokenId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotSeller();
        if (newPrice == 0) revert InvalidPrice();

        l.price = newPrice;
        emit PriceUpdated(tokenId, msg.sender, newPrice);
    }

    /// @notice Cancel an active listing and reclaim the escrowed NFT.
    function cancelListing(uint256 tokenId) external nonReentrant {
        Listing memory listing = listings[tokenId];
        if (!listing.active) revert NotActive();
        if (msg.sender != listing.seller) revert NotSeller();

        listings[tokenId].active = false;

        IERC721(modelNFT).safeTransferFrom(address(this), listing.seller, tokenId);

        emit ListingCancelled(tokenId, listing.seller);
    }

    // ---------------------------------------------------------------------
    // Buyer actions
    // ---------------------------------------------------------------------

    /// @notice Buy a listed model. msg.value must equal listing.price exactly.
    /// @dev    Payment splits in priority: royalty → creator, fee → recipient,
    ///         remainder → seller. Effects (active=false) committed before any
    ///         external interaction; transfers use low-level call with success
    ///         checks.
    function buyModel(uint256 tokenId) external payable nonReentrant {
        Listing memory listing = listings[tokenId];
        if (!listing.active) revert NotActive();
        if (msg.value != listing.price) revert InvalidPayment();
        if (msg.sender == listing.seller) revert SelfTrade();

        // Effects.
        listings[tokenId].active = false;

        // Compute splits.
        uint256 royalty = (msg.value * royaltyBps) / BPS_DENOMINATOR;
        uint256 fee = (msg.value * feeBps) / BPS_DENOMINATOR;
        uint256 sellerAmount = msg.value - royalty - fee;

        address modelCreator = IModelNFTCreator(modelNFT).creator(tokenId);

        // Interactions.
        if (royalty > 0 && modelCreator != address(0)) {
            (bool okR, ) = payable(modelCreator).call{value: royalty}("");
            if (!okR) revert TransferFailed();
        } else {
            // No creator on file → fold royalty back into seller payout.
            sellerAmount += royalty;
            royalty = 0;
        }

        if (fee > 0) {
            (bool okF, ) = payable(feeRecipient).call{value: fee}("");
            if (!okF) revert TransferFailed();
        }

        (bool okS, ) = payable(listing.seller).call{value: sellerAmount}("");
        if (!okS) revert TransferFailed();

        IERC721(modelNFT).safeTransferFrom(address(this), msg.sender, tokenId);

        emit ModelSold(tokenId, msg.sender, listing.price, sellerAmount, royalty, fee);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Batch-fetch listings for a list of tokenIds. Frontend-friendly
    ///         alternative to iterating over the public mapping.
    function getActiveListings(uint256[] calldata tokenIds)
        external
        view
        returns (Listing[] memory result)
    {
        result = new Listing[](tokenIds.length);
        for (uint256 i; i < tokenIds.length; ++i) {
            result[i] = listings[tokenIds[i]];
        }
    }

    // ---------------------------------------------------------------------
    // ERC721 receiver
    // ---------------------------------------------------------------------

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}
