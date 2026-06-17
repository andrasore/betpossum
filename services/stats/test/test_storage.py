"""Storage boundary tests: idempotent upsert, per-user scoping, leaderboard."""

from db import StatsStore


async def _record(
    store: StatsStore,
    *,
    bet_id: str,
    user_id: str,
    user_name: str | None = None,
    settled_at: int = 1_700_000_000_000,
    stake_cents: int = 10_000,
    profit_cents: int = 5_000,
) -> None:
    await store.record_settlement(
        bet_id=bet_id,
        user_id=user_id,
        user_name=user_name,
        settled_at=settled_at,
        stake_cents=stake_cents,
        profit_cents=profit_cents,
    )


async def test_duplicate_bet_id_is_a_no_op(store: StatsStore) -> None:
    await _record(
        store, bet_id="b1", user_id="u1", stake_cents=10_000, profit_cents=5_000
    )
    # Redelivery with a different (stale) amount must not overwrite or double-count.
    await _record(store, bet_id="b1", user_id="u1", stake_cents=99_999, profit_cents=1)

    rows = await store.user_rows("u1")
    assert len(rows) == 1
    assert rows[0].stake_cents == 10_000
    assert rows[0].profit_cents == 5_000


async def test_user_rows_are_scoped_and_ordered(store: StatsStore) -> None:
    await _record(store, bet_id="b2", user_id="u1", settled_at=200)
    await _record(store, bet_id="b1", user_id="u1", settled_at=100)
    await _record(store, bet_id="b3", user_id="u2", settled_at=150)

    rows = await store.user_rows("u1")
    assert [r.settled_at for r in rows] == [100, 200]


async def test_leaderboard_filters_min_settled_and_ranks_by_roi(
    store: StatsStore,
) -> None:
    # winner: 2 bets, +100 on 200 staked => 50% ROI
    await _record(
        store,
        bet_id="w1",
        user_id="winner",
        user_name="Win",
        stake_cents=10_000,
        profit_cents=10_000,
    )
    await _record(
        store,
        bet_id="w2",
        user_id="winner",
        user_name="Win",
        stake_cents=10_000,
        profit_cents=-10_000 + 10_000,
    )
    # midfield: 2 bets, +20 on 200 => 10% ROI
    await _record(
        store,
        bet_id="m1",
        user_id="mid",
        user_name="Mid",
        stake_cents=10_000,
        profit_cents=2_000,
    )
    await _record(
        store,
        bet_id="m2",
        user_id="mid",
        user_name="Mid",
        stake_cents=10_000,
        profit_cents=0,
    )
    # lone big winner with only 1 bet — excluded by min_settled=2
    await _record(
        store,
        bet_id="x1",
        user_id="lucky",
        user_name="Lucky",
        stake_cents=100,
        profit_cents=100_000,
    )

    board = await store.leaderboard(min_settled=2, limit=10)
    ids = [e.userId for e in board]
    assert ids == ["winner", "mid"]
    assert board[0].roiPct == 50.0
