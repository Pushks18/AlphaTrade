from unittest.mock import MagicMock, patch
import pytest
from meta_agent.keeper_client import KeeperClient

VAULT = "0x" + "ab" * 20
OPERATOR_KEY = "0x" + "cd" * 32


def _make_client():
    with patch("meta_agent.keeper_client.Web3") as MockWeb3:
        mock_w3 = MockWeb3.return_value
        mock_w3.eth.block_number = 100
        mock_w3.eth.contract.return_value = MagicMock()
        mock_w3.eth.send_raw_transaction.return_value = bytes(32)
        return KeeperClient(VAULT, OPERATOR_KEY, "http://localhost:8545"), mock_w3


def test_sign_trade_produces_65_byte_sig():
    client, _ = _make_client()
    weights = [2000, 2000, 2000, 2000, 2000]
    sig = client._sign(weights, 100)
    assert len(sig) == 65


def test_execute_trade_calls_contract():
    client, mock_w3 = _make_client()
    weights = [2000, 2000, 2000, 2000, 2000]
    # Provide a dict for build_transaction so sign_transaction doesn't choke
    fake_tx = {"gas": 500_000, "nonce": 0, "to": VAULT, "value": 0, "data": b"", "chainId": 1}
    client.vault.functions.executeTrade.return_value.build_transaction.return_value = fake_tx
    with patch.object(client, "_sign", return_value=b"\x00" * 65), \
         patch.object(client.account, "sign_transaction") as mock_sign:
        mock_sign.return_value = MagicMock(raw_transaction=bytes(32))
        client.execute_trade(weights)
    client.vault.functions.executeTrade.assert_called_once()
