import os
from typing import Annotated

from fastapi import APIRouter, Depends

from aggregate import cumulative_roi_series, summarise
from auth import current_user_sub
from store_dep import StoreDep

router = APIRouter(prefix="/stats", tags=["stats"])

LEADERBOARD_LIMIT = int(os.environ.get("LEADERBOARD_LIMIT", "7"))
LEADERBOARD_MIN_SETTLED = int(os.environ.get("LEADERBOARD_MIN_SETTLED", "3"))


@router.get("/me/pnl")
async def my_pnl(
    store: StoreDep, sub: Annotated[str, Depends(current_user_sub)]
) -> list[dict[str, object]]:
    rows = await store.user_rows(sub)
    return [{"date": p.date, "roiPct": p.roiPct} for p in cumulative_roi_series(rows)]


@router.get("/me/summary")
async def my_summary(
    store: StoreDep, sub: Annotated[str, Depends(current_user_sub)]
) -> dict[str, object]:
    rows = await store.user_rows(sub)
    s = summarise(rows)
    return {
        "totalStaked": s.totalStaked,
        "settledCount": s.settledCount,
        "wins": s.wins,
        "winRatePct": s.winRatePct,
        "netProfit": s.netProfit,
        "roiPct": s.roiPct,
    }


@router.get("/leaderboard")
async def leaderboard(store: StoreDep) -> list[dict[str, object]]:
    entries = await store.leaderboard(
        min_settled=LEADERBOARD_MIN_SETTLED, limit=LEADERBOARD_LIMIT
    )
    return [
        {
            "userId": e.userId,
            "userName": e.userName,
            "roiPct": e.roiPct,
            "netProfit": e.netProfit,
            "settledCount": e.settledCount,
        }
        for e in entries
    ]
