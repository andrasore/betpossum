"""Redis subscriber — runs in a background thread alongside Flask."""
import logging
import os
import threading
import time
import redis
import uuid

logger = logging.getLogger(__name__)


def _load_proto():
    import subprocess, sys
    out = "/tmp/proto_gen"
    os.makedirs(out, exist_ok=True)
    subprocess.check_call([
        sys.executable, "-m", "grpc_tools.protoc",
        "-I/proto", f"--python_out={out}", "/proto/events.proto",
    ])
    sys.path.insert(0, out)
    import events_pb2
    return events_pb2


def _handle_bet_placed(event, ledger, r_pub, TxConfirmed):
    amount_cents = int(float(event.stake) * 100)
    try:
        ledger.hold(event.user_id, event.bet_id, amount_cents)
        msg = TxConfirmed(
            tx_id=str(uuid.uuid4()),
            bet_id=event.bet_id,
            user_id=event.user_id,
            type="hold",
            amount=float(event.stake),
            confirmed_at=int(time.time() * 1000),
        )
        r_pub.publish("tx.confirmed", msg.SerializeToString())
        logger.info("Held %.2f for bet %s", event.stake, event.bet_id)
    except Exception as e:
        logger.error("hold failed for bet %s: %s", event.bet_id, e)


def _handle_bet_settled(event, ledger, r_pub, TxConfirmed):
    amount_cents = int(float(event.payout) * 100) if event.won else 0
    try:
        if event.won:
            ledger.payout(event.user_id, event.bet_id, amount_cents)
            tx_type = "payout"
        else:
            # Held funds were already consumed; nothing to release for a loss.
            tx_type = "release"
        msg = TxConfirmed(
            tx_id=str(uuid.uuid4()),
            bet_id=event.bet_id,
            user_id=event.user_id,
            type=tx_type,
            amount=float(event.payout),
            confirmed_at=int(time.time() * 1000),
        )
        r_pub.publish("tx.confirmed", msg.SerializeToString())
    except Exception as e:
        logger.error("settle failed for bet %s: %s", event.bet_id, e)


def run(redis_url: str, ledger):
    pb2 = _load_proto()
    r_sub = redis.from_url(redis_url)
    r_pub = redis.from_url(redis_url)
    pubsub = r_sub.pubsub()
    pubsub.subscribe("bet.placed", "bet.settled")

    logger.info("Wallet subscriber ready")
    for message in pubsub.listen():
        if message["type"] != "message":
            continue
        channel = message["channel"].decode()
        data: bytes = message["data"]
        try:
            if channel == "bet.placed":
                event = pb2.BetPlacedEvent.FromString(data)
                _handle_bet_placed(event, ledger, r_pub, pb2.TransactionConfirmedEvent)
            elif channel == "bet.settled":
                event = pb2.BetSettledEvent.FromString(data)
                _handle_bet_settled(event, ledger, r_pub, pb2.TransactionConfirmedEvent)
        except Exception as e:
            logger.error("Failed to process %s: %s", channel, e)


def start_background(redis_url: str, ledger):
    t = threading.Thread(target=run, args=(redis_url, ledger), daemon=True)
    t.start()
