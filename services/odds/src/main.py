import asyncio
import logging
import os
import threading
from flask import Flask, jsonify
from poller import run_poller

logging.basicConfig(level=logging.INFO)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
THE_ODDS_API_KEY = os.environ.get("THE_ODDS_API_KEY", "demo")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))


def _start_poller():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_poller(THE_ODDS_API_KEY, REDIS_URL, POLL_INTERVAL_SECONDS))


threading.Thread(target=_start_poller, daemon=True, name="odds-poller").start()

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})
