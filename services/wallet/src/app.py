import os
import logging
from flask import Flask, jsonify, request
from ledger import LedgerClient
import subscriber

logging.basicConfig(level=logging.INFO)

app = Flask(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
SIDECAR_URL = os.environ.get("SIDECAR_URL", "http://localhost:8080")
ledger = LedgerClient(SIDECAR_URL)

# Start Redis subscriber in a background thread
subscriber.start_background(REDIS_URL, ledger)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/accounts")
def create_account():
    data = request.get_json(force=True)
    result = ledger.create_account(data["user_id"])
    return jsonify(result), 201


@app.get("/accounts/<user_id>/balance")
def get_balance(user_id: str):
    balance_cents = ledger.get_balance(user_id)
    return jsonify({"user_id": user_id, "balance": balance_cents / 100})


@app.post("/deposit")
def deposit():
    data = request.get_json(force=True)
    user_id: str = data["user_id"]
    amount_cents = int(float(data["amount"]) * 100)
    result = ledger.payout(user_id, "deposit", amount_cents)
    return jsonify(result), 201
