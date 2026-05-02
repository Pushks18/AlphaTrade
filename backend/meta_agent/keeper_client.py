from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import to_checksum_address
from web3 import Web3

# Minimal ABI for executeTrade.
# Note: weights are uint16[5] to hold BPS values up to 10_000 (uint8 max is 255).
VAULT_ABI = [
    {
        "name": "executeTrade",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "targetWeightsBps", "type": "uint16[5]"},
            {"name": "blockNumber",      "type": "uint256"},
            {"name": "sig",              "type": "bytes"},
        ],
        "outputs": [],
    }
]


class KeeperClient:
    def __init__(self, vault_addr: str, operator_key: str, rpc_url: str):
        self._vault_addr = to_checksum_address(vault_addr)  # checksum, independent of Web3 mock
        self.w3          = Web3(Web3.HTTPProvider(rpc_url))
        self.account     = Account.from_key(operator_key)
        self.vault       = self.w3.eth.contract(
            address=self._vault_addr,
            abi=VAULT_ABI,
        )

    def _sign(self, weights: list[int], block_number: int) -> bytes:
        # Must match Solidity: keccak256(abi.encodePacked(uint16[5], uint256, address))
        msg_hash = Web3.solidity_keccak(
            ["uint16", "uint16", "uint16", "uint16", "uint16", "uint256", "address"],
            [*weights, block_number, self._vault_addr],
        )
        signed = self.account.sign_message(encode_defunct(primitive=msg_hash))
        return bytes(signed.signature)

    def execute_trade(self, weights: list[int]) -> str:
        block_number = self.w3.eth.block_number
        sig = self._sign(weights, block_number)
        tx = self.vault.functions.executeTrade(
            weights, block_number, sig
        ).build_transaction({
            "from":  self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas":   500_000,
        })
        signed_tx = self.account.sign_transaction(tx)
        return self.w3.eth.send_raw_transaction(signed_tx.raw_transaction).hex()
