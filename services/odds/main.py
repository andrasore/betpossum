import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    the_odds_api_key: str = "demo"
    poll_interval_seconds: int = 30

    class Config:
        env_file = ".env"


settings = Settings()
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from poller import run_poller
    task = asyncio.create_task(
        run_poller(settings.the_odds_api_key, settings.redis_url, settings.poll_interval_seconds)
    )
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Betting Odds Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}
