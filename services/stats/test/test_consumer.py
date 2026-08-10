"""Consumer boundary: BetSettledEvent JSON -> signed-cents row -> DB readback.

Drives `consumer.handle` with real event bytes (built from the generated model,
so the test tracks the contract) against the testcontainer-backed store, then
reads the row back. The signed-cents convention (win = +payout, loss = -stake) is the thing that
silently corrupts every downstream P&L number, so it is asserted end-to-end
rather than in isolation. Amounts arrive as integer cents and are stored
verbatim — nothing here rounds, which is what keeps this read model identical
to Core's ledger.
"""

import pytest
from pydantic import ValidationError

from consumer import handle
from storage.base import StatsStorage
from generated.events import BetSettledEvent


def _event_bytes(
    *,
    bet_id: str = "b1",
    user_id: str = "u1",
    user_name: str | None = "Al",
    won: bool,
    stake_cents: int,
    payout_cents: int,
    settled_at: int = 1_700_000_000_000,
) -> bytes:
    return (
        BetSettledEvent(
            userId=user_id,
            userName=user_name,
            betId=bet_id,
            eventId="e1",
            selection="home",
            odds=2.0,
            stakeCents=stake_cents,
            won=won,
            payoutCents=payout_cents,
            settledAt=settled_at,
        )
        .model_dump_json()
        .encode()
    )


async def test_win_maps_payout_to_positive_cents(store: StatsStorage) -> None:
    await handle(store, _event_bytes(won=True, stake_cents=1_000, payout_cents=1_500))

    rows = await store.user_rows("u1")
    assert len(rows) == 1
    assert rows[0].stake_cents == 1_000
    assert rows[0].profit_cents == 1_500


async def test_loss_maps_stake_to_negative_cents(store: StatsStorage) -> None:
    await handle(store, _event_bytes(won=False, stake_cents=1_000, payout_cents=0))

    rows = await store.user_rows("u1")
    assert len(rows) == 1
    assert rows[0].stake_cents == 1_000
    assert rows[0].profit_cents == -1_000


async def test_cents_are_stored_verbatim_without_rounding(store: StatsStorage) -> None:
    # An odd-cent profit that a dollars round-trip would have been free to
    # shift by one — it must survive the consumer untouched.
    await handle(store, _event_bytes(won=True, stake_cents=333, payout_cents=167))

    rows = await store.user_rows("u1")
    assert rows[0].stake_cents == 333
    assert rows[0].profit_cents == 167


async def test_malformed_body_is_rejected_before_any_write(store: StatsStorage) -> None:
    # consumer.run() relies on this raising so it can nack/requeue.
    with pytest.raises(ValidationError):
        await handle(store, b"{}")

    assert await store.user_rows("u1") == []


async def test_redelivery_of_same_event_is_a_no_op(store: StatsStorage) -> None:
    body = _event_bytes(won=True, stake_cents=1_000, payout_cents=1_500)
    await handle(store, body)
    await handle(store, body)

    rows = await store.user_rows("u1")
    assert len(rows) == 1
