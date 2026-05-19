import asyncio
import logging
import os
import threading

from flask import Flask, jsonify

from providers import get_provider
from publisher import OddsPublisher
from runner import run
from storage import get_storage

logging.basicConfig(level=logging.INFO)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
PROVIDER_NAME = os.environ.get("ODDS_PROVIDER", "mock")
STORAGE_NAME = os.environ.get("ODDS_STORAGE", "postgres")


def _start_worker():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    provider = get_provider(PROVIDER_NAME)
    storage = get_storage(STORAGE_NAME)
    publisher = OddsPublisher(REDIS_URL)
    loop.run_until_complete(run(provider, storage, publisher, POLL_INTERVAL_SECONDS))


threading.Thread(
    target=_start_worker,
    daemon=True,
    name=f"odds-worker-{PROVIDER_NAME}-{STORAGE_NAME}",
).start()

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(
        {"status": "ok", "provider": PROVIDER_NAME, "storage": STORAGE_NAME}
    )
