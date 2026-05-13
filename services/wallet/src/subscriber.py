"""Redis subscriber — runs in a background thread alongside Flask."""
import logging
import threading
import time
import uuid
import redis
from generated.events_pb2 import (
    BetPlacedEvent, BetSettledEvent, TransactionConfirmedEvent,
    BalanceUpdatedEvent,
)

logger = logging.getLogger(__name__)


def _publish_balance_updated(user_id: str, ledger, r_pub: redis.Redis) -> None:
    balance_cents = ledger.get_balance(user_id)
    msg = BalanceUpdatedEvent(user_id=user_id, balance=balance_cents / 100)
    r_pub.publish("balance.updated", msg.SerializeToString())


def _handle_bet_placed(event: BetPlacedEvent, ledger, r_pub: redis.Redis) -> None:
    amount_cents = int(float(event.stake) * 100)
    try:
        ledger.hold(event.user_id, event.bet_id, amount_cents)
        msg = TransactionConfirmedEvent(
            tx_id=str(uuid.uuid4()),
            bet_id=event.bet_id,
            user_id=event.user_id,
            type="hold",
            amount=float(event.stake),
            confirmed_at=int(time.time() * 1000),
        )
        r_pub.publish("tx.confirmed", msg.SerializeToString())
        _publish_balance_updated(event.user_id, ledger, r_pub)
        logger.info("Held %.2f for bet %s", event.stake, event.bet_id)
    except Exception as e:
        logger.error("hold failed for bet %s: %s", event.bet_id, e)


def _handle_bet_settled(event: BetSettledEvent, ledger, r_pub: redis.Redis) -> None:
    amount_cents = int(float(event.payout) * 100) if event.won else 0
    try:
        if event.won:
            ledger.payout(event.user_id, event.bet_id, amount_cents)
            tx_type = "payout"
        else:
            tx_type = "release"
        msg = TransactionConfirmedEvent(
            tx_id=str(uuid.uuid4()),
            bet_id=event.bet_id,
            user_id=event.user_id,
            type=tx_type,
            amount=float(event.payout),
            confirmed_at=int(time.time() * 1000),
        )
        r_pub.publish("tx.confirmed", msg.SerializeToString())
        _publish_balance_updated(event.user_id, ledger, r_pub)
    except Exception as e:
        logger.error("settle failed for bet %s: %s", event.bet_id, e)


def run(redis_url: str, ledger) -> None:
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
                _handle_bet_placed(BetPlacedEvent.FromString(data), ledger, r_pub)
            elif channel == "bet.settled":
                _handle_bet_settled(BetSettledEvent.FromString(data), ledger, r_pub)
        except Exception as e:
            logger.error("Failed to process %s: %s", channel, e)


def start_background(redis_url: str, ledger) -> None:
    threading.Thread(target=run, args=(redis_url, ledger), daemon=True).start()
