import os
import uuid
import logging
from flask import Flask, jsonify, request
from ledger import LedgerClient
import subscriber

logging.basicConfig(level=logging.INFO)

app = Flask(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
TB_ADDRESS = os.environ.get("TIGERBEETLE_ADDRESS", "3000")
TB_CLUSTER_ID = int(os.environ.get("TIGERBEETLE_CLUSTER_ID", "0"))

ledger = LedgerClient(TB_ADDRESS, TB_CLUSTER_ID)
subscriber.start_background(REDIS_URL, ledger)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/accounts")
def create_account():
    data = request.get_json(force=True)
    ledger.create_account(data["user_id"])
    return jsonify({"status": "ok"}), 201


@app.get("/accounts/<user_id>/balance")
def get_balance(user_id: str):
    balance_cents = ledger.get_balance(user_id)
    return jsonify({"user_id": user_id, "balance": balance_cents / 100})


@app.post("/deposit")
def deposit():
    data = request.get_json(force=True)
    user_id: str = data["user_id"]
    amount_cents = int(float(data["amount"]) * 100)
    ledger.payout(user_id, str(uuid.uuid4()), amount_cents)
    return jsonify({"status": "ok"}), 201
