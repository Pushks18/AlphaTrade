// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IModelMarketplace {
    function listModel(uint256 tokenId, uint256 price) external;
}
