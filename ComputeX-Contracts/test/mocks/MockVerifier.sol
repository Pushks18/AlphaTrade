// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IEzklVerifier} from "../../src/PerformanceOracle.sol";

contract MockVerifier is IEzklVerifier {
    bool public answer = true;
    function setAnswer(bool a) external { answer = a; }
    function verifyProof(bytes calldata, uint256[] calldata) external view returns (bool) {
        return answer;
    }
}
