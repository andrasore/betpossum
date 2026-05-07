import uuid
from ledger import LedgerClient


def new_id() -> str:
    return str(uuid.uuid4())


def test_create_account_starts_at_zero(ledger: LedgerClient) -> None:
    user_id = new_id()
    ledger.create_account(user_id)
    assert ledger.get_balance(user_id) == 0


def test_unknown_account_returns_zero(ledger: LedgerClient) -> None:
    assert ledger.get_balance(new_id()) == 0


def test_payout_increases_balance(ledger: LedgerClient) -> None:
    user_id = new_id()
    ledger.create_account(user_id)
    ledger.payout(user_id, new_id(), 500)
    assert ledger.get_balance(user_id) == 500


def test_hold_reduces_balance(ledger: LedgerClient) -> None:
    user_id = new_id()
    ledger.create_account(user_id)
    ledger.payout(user_id, new_id(), 1000)
    ledger.hold(user_id, new_id(), 300)
    assert ledger.get_balance(user_id) == 700


def test_release_restores_balance(ledger: LedgerClient) -> None:
    user_id = new_id()
    bet_id = new_id()
    ledger.create_account(user_id)
    ledger.payout(user_id, new_id(), 1000)
    ledger.hold(user_id, bet_id, 400)
    ledger.release(user_id, bet_id, 400)
    assert ledger.get_balance(user_id) == 1000


def test_keep_leaves_user_balance_reduced(ledger: LedgerClient) -> None:
    """After losing: hold moves funds to escrow, keep moves them on to house."""
    user_id = new_id()
    bet_id = new_id()
    ledger.create_account(user_id)
    ledger.payout(user_id, new_id(), 1000)
    ledger.hold(user_id, bet_id, 600)
    ledger.keep(bet_id, 600)
    assert ledger.get_balance(user_id) == 400


def test_multiple_holds_accumulate(ledger: LedgerClient) -> None:
    user_id = new_id()
    ledger.create_account(user_id)
    ledger.payout(user_id, new_id(), 1000)
    ledger.hold(user_id, new_id(), 200)
    ledger.hold(user_id, new_id(), 300)
    assert ledger.get_balance(user_id) == 500
