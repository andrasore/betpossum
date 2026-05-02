"""Thin wrapper around the TigerBeetle Node.js sidecar REST API."""
import uuid
import requests


class LedgerClient:
    def __init__(self, sidecar_url: str):
        self._base = sidecar_url.rstrip("/")

    def _post(self, path: str, body: dict) -> dict:
        resp = requests.post(f"{self._base}{path}", json=body, timeout=5)
        resp.raise_for_status()
        return resp.json()

    def create_account(self, user_id: str) -> dict:
        return self._post("/accounts", {
            "id": self._user_to_account_id(user_id),
            "ledger": 1,
            "code": 1,
        })

    def hold(self, user_id: str, bet_id: str, amount_cents: int) -> dict:
        """Reserve funds for a pending bet (debit user, credit escrow)."""
        return self._post("/transfers", {
            "id": str(uuid.uuid4()).replace("-", ""),
            "debit_account_id": self._user_to_account_id(user_id),
            "credit_account_id": "escrow",
            "amount": amount_cents,
            "code": 1,
            "user_data_128": bet_id.replace("-", ""),
        })

    def release(self, user_id: str, bet_id: str, amount_cents: int) -> dict:
        """Return held funds to user (debit escrow, credit user)."""
        return self._post("/transfers", {
            "id": str(uuid.uuid4()).replace("-", ""),
            "debit_account_id": "escrow",
            "credit_account_id": self._user_to_account_id(user_id),
            "amount": amount_cents,
            "code": 2,
            "user_data_128": bet_id.replace("-", ""),
        })

    def payout(self, user_id: str, bet_id: str, amount_cents: int) -> dict:
        """Credit winnings to user (debit house, credit user)."""
        return self._post("/transfers", {
            "id": str(uuid.uuid4()).replace("-", ""),
            "debit_account_id": "house",
            "credit_account_id": self._user_to_account_id(user_id),
            "amount": amount_cents,
            "code": 3,
            "user_data_128": bet_id.replace("-", ""),
        })

    def get_balance(self, user_id: str) -> int:
        resp = requests.get(
            f"{self._base}/accounts/{self._user_to_account_id(user_id)}", timeout=5
        )
        resp.raise_for_status()
        return resp.json()["credits_posted"] - resp.json()["debits_posted"]

    @staticmethod
    def _user_to_account_id(user_id: str) -> str:
        return user_id.replace("-", "")
