import asyncio
import logging
import os
import threading
from flask import Flask, jsonify

logging.basicConfig(level=logging.INFO)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
THE_ODDS_API_KEY = os.environ.get("THE_ODDS_API_KEY", "demo")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
MOCK = os.environ.get("MOCK", "false").lower() == "true"


def _start_worker():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    if MOCK:
        from generator import run_generator
        loop.run_until_complete(run_generator(REDIS_URL, POLL_INTERVAL_SECONDS))
    else:
        from poller import run_poller
        loop.run_until_complete(run_poller(THE_ODDS_API_KEY, REDIS_URL, POLL_INTERVAL_SECONDS))


mode = "mock" if MOCK else "live"
threading.Thread(target=_start_worker, daemon=True, name=f"odds-worker-{mode}").start()

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "mode": mode})
