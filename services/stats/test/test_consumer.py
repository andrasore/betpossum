"""Consumer boundary: BetSettledEvent JSON -> signed-cents row -> DB readback.

Drives `consumer.handle` with real event bytes (built from the generated model,
so the test tracks the contract) against the testcontainer-backed store, then
reads the row back. The signed-cents convention (win = +payout, loss = -stake)
and the dollars->cents conversion are the things that silently corrupt every
downstream P&L number, so they are asserted end-to-end rather than in isolation.
"""

import pytest
from pydantic import ValidationError

from consumer import handle
from db import StatsStore
from generated.events import BetSettledEvent


def _event_bytes(
    *,
    bet_id: str = "b1",
    user_id: str = "u1",
    user_name: str | None = "Al",
    won: bool,
    stake: float,
    payout: float,
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
            stake=stake,
            won=won,
            payout=payout,
            settledAt=settled_at,
        )
        .model_dump_json()
        .encode()
    )


async def test_win_maps_payout_to_positive_cents(store: StatsStore) -> None:
    await handle(store, _event_bytes(won=True, stake=10.0, payout=15.0))

    rows = await store.user_rows("u1")
    assert len(rows) == 1
    assert rows[0].stake_cents == 1_000
    assert rows[0].profit_cents == 1_500


async def test_loss_maps_stake_to_negative_cents(store: StatsStore) -> None:
    await handle(store, _event_bytes(won=False, stake=10.0, payout=0.0))

    rows = await store.user_rows("u1")
    assert len(rows) == 1
    assert rows[0].stake_cents == 1_000
    assert rows[0].profit_cents == -1_000


async def test_fractional_dollars_round_to_cents(store: StatsStore) -> None:
    await handle(store, _event_bytes(won=True, stake=2.50, payout=3.75))

    rows = await store.user_rows("u1")
    assert rows[0].stake_cents == 250
    assert rows[0].profit_cents == 375


async def test_malformed_body_is_rejected_before_any_write(store: StatsStore) -> None:
    # consumer.run() relies on this raising so it can nack/requeue.
    with pytest.raises(ValidationError):
        await handle(store, b"{}")

    assert await store.user_rows("u1") == []


async def test_redelivery_of_same_event_is_a_no_op(store: StatsStore) -> None:
    body = _event_bytes(won=True, stake=10.0, payout=15.0)
    await handle(store, body)
    await handle(store, body)

    rows = await store.user_rows("u1")
    assert len(rows) == 1
