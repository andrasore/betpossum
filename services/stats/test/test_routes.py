"""HTTP boundary: serialization (dollars, key names, shapes) and the auth split.

Runs the real `app` through an in-process ASGI transport (no network, no
lifespan -> the RabbitMQ consumer never starts). `get_stats_storage` is
overridden to a testcontainer-backed store seeded per test; `current_user_sub`
is overridden only where a caller identity is required, so the
protected-vs-public split is exercised for real (missing token -> 401 from the
bearer scheme).
"""

from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app import app
from auth import current_user_sub
from storage.base import StatsStorage
from storage.dependencies import get_stats_storage


async def _seed(store: StatsStorage, **kw: object) -> None:
    base = dict(
        bet_id="b",
        user_id="u1",
        user_name=None,
        settled_at=1_700_000_000_000,
        stake_cents=10_000,
        profit_cents=5_000,
    )
    base.update(kw)
    await store.record_settlement(**base)  # pyright: ignore[reportArgumentType]


@pytest_asyncio.fixture
async def client(store: StatsStorage) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_stats_storage] = lambda: store
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_me_summary_is_scoped_and_in_dollars(
    store: StatsStorage, client: AsyncClient
) -> None:
    await _seed(
        store, bet_id="a1", user_id="u1", stake_cents=10_000, profit_cents=5_000
    )
    await _seed(
        store, bet_id="a2", user_id="u1", stake_cents=10_000, profit_cents=-10_000
    )
    await _seed(
        store, bet_id="b1", user_id="u2", stake_cents=99_999, profit_cents=99_999
    )
    app.dependency_overrides[current_user_sub] = lambda: "u1"

    resp = await client.get("/stats/me/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {
        "totalStaked",
        "settledCount",
        "wins",
        "winRatePct",
        "netProfit",
        "roiPct",
    }
    # Only u1's two rows; money in dollars (cents / 100).
    assert body["settledCount"] == 2
    assert body["wins"] == 1
    assert body["totalStaked"] == 200.0
    assert body["netProfit"] == -50.0


async def test_me_pnl_returns_date_roi_points_scoped_to_sub(
    store: StatsStorage, client: AsyncClient
) -> None:
    await _seed(store, bet_id="a1", user_id="u1", settled_at=1_700_000_000_000)
    await _seed(store, bet_id="b1", user_id="u2", settled_at=1_700_000_000_000)
    app.dependency_overrides[current_user_sub] = lambda: "u1"

    resp = await client.get("/stats/me/pnl")
    assert resp.status_code == 200
    points = resp.json()
    assert len(points) == 1
    assert set(points[0]) == {"date", "roiPct"}


async def test_auth_split_me_requires_token_leaderboard_public(
    client: AsyncClient,
) -> None:
    # No current_user_sub override and no Authorization header.
    assert (await client.get("/stats/me/summary")).status_code == 401
    assert (await client.get("/stats/leaderboard")).status_code == 200


async def test_leaderboard_ranks_by_roi(
    store: StatsStorage, client: AsyncClient
) -> None:
    # Default LEADERBOARD_MIN_SETTLED is 3, so give each user 3 bets.
    # winner: +100 on 300 staked => 33.33% ROI; mid: +20 on 300 => 6.67%.
    await _seed(
        store,
        bet_id="w1",
        user_id="winner",
        user_name="Win",
        stake_cents=10_000,
        profit_cents=10_000,
    )
    await _seed(
        store,
        bet_id="w2",
        user_id="winner",
        user_name="Win",
        stake_cents=10_000,
        profit_cents=0,
    )
    await _seed(
        store,
        bet_id="w3",
        user_id="winner",
        user_name="Win",
        stake_cents=10_000,
        profit_cents=0,
    )
    await _seed(
        store,
        bet_id="m1",
        user_id="mid",
        user_name="Mid",
        stake_cents=10_000,
        profit_cents=2_000,
    )
    await _seed(
        store,
        bet_id="m2",
        user_id="mid",
        user_name="Mid",
        stake_cents=10_000,
        profit_cents=0,
    )
    await _seed(
        store,
        bet_id="m3",
        user_id="mid",
        user_name="Mid",
        stake_cents=10_000,
        profit_cents=0,
    )

    resp = await client.get("/stats/leaderboard")
    assert resp.status_code == 200
    board = resp.json()
    assert [e["userId"] for e in board] == ["winner", "mid"]
    assert set(board[0]) == {
        "userId",
        "userName",
        "roiPct",
        "netProfit",
        "settledCount",
    }
    assert board[0]["roiPct"] == 33.33
    assert board[0]["netProfit"] == 100.0
