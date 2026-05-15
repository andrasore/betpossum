import base64
import json
import os
import uuid
import logging
from flask import Flask, jsonify, request
from ledger import LedgerClient
import subscriber
from util import resolve_to_ip

logging.basicConfig(level=logging.INFO)

app = Flask(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
TB_ADDRESS = os.environ.get("TIGERBEETLE_ADDRESS", "localhost:6000")
TB_CLUSTER_ID = int(os.environ.get("TIGERBEETLE_CLUSTER_ID", "0"))

ledger = LedgerClient(resolve_to_ip(TB_ADDRESS), TB_CLUSTER_ID)
subscriber.start_background(REDIS_URL, ledger)


def _user_id_from_bearer() -> str | None:
    # TODO: verify the JWT signature with the shared secret instead of trusting
    # the payload. Tracked as part of the per-service JWT verification rollout.
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    parts = auth[7:].split(".")
    if len(parts) != 3:
        return None
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, json.JSONDecodeError):
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


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


@app.get("/wallet/balance")
def get_balance_for_caller():
    user_id = _user_id_from_bearer()
    if user_id is None:
        return jsonify({"error": "unauthorized"}), 401
    balance_cents = ledger.get_balance(user_id)
    return jsonify({"balance": balance_cents / 100})


@app.post("/deposit")
def deposit():
    data = request.get_json(force=True)
    user_id: str = data["user_id"]
    amount_cents = int(float(data["amount"]) * 100)
    ledger.deposit(user_id, amount_cents)
    return jsonify({"status": "ok"}), 201
