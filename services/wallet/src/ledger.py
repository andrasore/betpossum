import logging
import tigerbeetle as tb

logger = logging.getLogger(__name__)

ESCROW_ID = 1
HOUSE_ID = 2

TC_HOLD = 1
TC_RELEASE = 2
TC_PAYOUT = 3
TC_KEEP = 4
TC_DEPOSIT = 5


class LedgerClient:
    def __init__(self, tb_address: str, cluster_id: int = 0):
        logger.info("Connecting to TigerBeetle cluster_id=%d address=%s", cluster_id, tb_address)
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
                flags=tb.AccountFlags(value=0), timestamp=0,
            ),
            tb.Account(
                id=HOUSE_ID, ledger=1, code=101,
                debits_pending=0, debits_posted=0,
                credits_pending=0, credits_posted=0,
                user_data_128=0, user_data_64=0, user_data_32=0,
                flags=tb.AccountFlags(value=0), timestamp=0,
            ),
        ])

    def create_account(self, user_id: str) -> None:
        self._client.create_accounts([
            tb.Account(
                id=self._to_id(user_id), ledger=1, code=1,
                debits_pending=0, debits_posted=0,
                credits_pending=0, credits_posted=0,
                user_data_128=0, user_data_64=0, user_data_32=0,
                flags=tb.AccountFlags(value=0), timestamp=0,
            )        ])

    def hold(self, user_id: str, bet_id: str, amount_cents: int) -> None:
        """Reserve funds for a pending bet (debit user → credit escrow)."""
        self._transfer(self._to_id(user_id), ESCROW_ID, amount_cents, code=TC_HOLD, bet_id=self._to_id(bet_id))

    def release(self, user_id: str, bet_id: str, amount_cents: int) -> None:
        """Return held funds to user (debit escrow → credit user)."""
        self._transfer(ESCROW_ID, self._to_id(user_id), amount_cents, code=TC_RELEASE, bet_id=self._to_id(bet_id))

    def payout(self, user_id: str, bet_id: str, amount_cents: int) -> None:
        """Credit winnings to user (debit house → credit user)."""
        self._transfer(HOUSE_ID, self._to_id(user_id), amount_cents, code=TC_PAYOUT, bet_id=self._to_id(bet_id))

    def deposit(self, user_id: str, amount_cents: int) -> None:
        """Add funds to user balance (debit house → credit user)."""
        self._transfer(HOUSE_ID, self._to_id(user_id), amount_cents, code=TC_DEPOSIT)

    def keep(self, bet_id: str, amount_cents: int) -> None:
        """House claims held funds after a losing bet (debit escrow → credit house)."""
        self._transfer(ESCROW_ID, HOUSE_ID, amount_cents, code=TC_KEEP, bet_id=self._to_id(bet_id))

    def close(self) -> None:
        self._client.close()

    def get_balance(self, user_id: str) -> int:
        accounts = self._client.lookup_accounts([self._to_id(user_id)])
        if not accounts:
            return 0
        a = accounts[0]
        return int(a.credits_posted) - int(a.debits_posted)

    def _transfer(self, debit_id: int, credit_id: int, amount: int, code: int, bet_id: int = 0) -> None:
        self._client.create_transfers([
            tb.Transfer(
                id=tb.id(),
                debit_account_id=debit_id,
                credit_account_id=credit_id,
                amount=amount,
                pending_id=0,
                user_data_128=bet_id,
                user_data_64=0,
                user_data_32=0,
                timeout=0,
                ledger=1,
                code=code,
                flags=tb.TransferFlags(value=0),
                timestamp=0,
            )
        ])

    @staticmethod
    def _to_id(value: str) -> int:
        return int(value.replace("-", ""), 16)
