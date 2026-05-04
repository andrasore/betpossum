import tigerbeetle as tb

ESCROW_ID = 1
HOUSE_ID = 2


class LedgerClient:
    def __init__(self, tb_address: str, cluster_id: int = 0):
        self._client = tb.ClientSync(
            cluster_id=cluster_id,
            replica_addresses=tb_address,
        )
        self._ensure_system_accounts()

    def _ensure_system_accounts(self) -> None:
        self._client.create_accounts([
            tb.Account(
                id=ESCROW_ID, ledger=1, code=100,
                debits_pending=0, debits_posted=0,
                credits_pending=0, credits_posted=0,
                user_data_128=0, user_data_64=0, user_data_32=0,
                flags=0, timestamp=0,
            ),
            tb.Account(
                id=HOUSE_ID, ledger=1, code=101,
                debits_pending=0, debits_posted=0,
                credits_pending=0, credits_posted=0,
                user_data_128=0, user_data_64=0, user_data_32=0,
                flags=0, timestamp=0,
            ),
        ])

    def create_account(self, user_id: str) -> None:
        self._client.create_accounts([
            tb.Account(
                id=self._to_id(user_id), ledger=1, code=1,
                debits_pending=0, debits_posted=0,
                credits_pending=0, credits_posted=0,
                user_data_128=0, user_data_64=0, user_data_32=0,
                flags=0, timestamp=0,
            )
        ])

    def hold(self, user_id: str, bet_id: str, amount_cents: int) -> None:
        """Reserve funds for a pending bet (debit user → credit escrow)."""
        self._transfer(self._to_id(user_id), ESCROW_ID, amount_cents, code=1, ref=self._to_id(bet_id))

    def release(self, user_id: str, bet_id: str, amount_cents: int) -> None:
        """Return held funds to user (debit escrow → credit user)."""
        self._transfer(ESCROW_ID, self._to_id(user_id), amount_cents, code=2, ref=self._to_id(bet_id))

    def payout(self, user_id: str, bet_id: str, amount_cents: int) -> None:
        """Credit winnings to user (debit house → credit user)."""
        self._transfer(HOUSE_ID, self._to_id(user_id), amount_cents, code=3, ref=self._to_id(bet_id))

    def get_balance(self, user_id: str) -> int:
        accounts = self._client.lookup_accounts([self._to_id(user_id)])
        if not accounts:
            return 0
        a = accounts[0]
        return int(a.credits_posted) - int(a.debits_posted)

    def _transfer(self, debit: int, credit: int, amount: int, code: int, ref: int = 0) -> None:
        self._client.create_transfers([
            tb.Transfer(
                id=tb.id(),
                debit_account_id=debit,
                credit_account_id=credit,
                amount=amount,
                pending_id=0,
                user_data_128=ref,
                user_data_64=0,
                user_data_32=0,
                timeout=0,
                ledger=1,
                code=code,
                flags=0,
                timestamp=0,
            )
        ])

    @staticmethod
    def _to_id(value: str) -> int:
        return int(value.replace("-", ""), 16)
