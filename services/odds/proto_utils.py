import os
import google.protobuf.descriptor_pool as descriptor_pool
from google.protobuf import descriptor_pb2
from grpc_tools import protoc  # type: ignore

# We compile the proto at runtime to avoid a separate build step.
# The /proto volume is mounted read-only; compiled descriptors go to /tmp.

_COMPILED = False
_pb2_module = None


def _ensure_compiled():
    global _COMPILED, _pb2_module
    if _COMPILED:
        return
    import subprocess, sys
    proto_path = "/proto"
    out_path = "/tmp/proto_gen"
    os.makedirs(out_path, exist_ok=True)
    subprocess.check_call(
        [
            sys.executable, "-m", "grpc_tools.protoc",
            f"-I{proto_path}",
            f"--python_out={out_path}",
            f"{proto_path}/events.proto",
        ]
    )
    sys.path.insert(0, out_path)
    import events_pb2 as pb2  # noqa: E402
    _pb2_module = pb2
    _COMPILED = True


def encode_odds_updated(event_id, sport, home_team, away_team,
                        home_odds, away_odds, draw_odds, updated_at) -> bytes:
    _ensure_compiled()
    msg = _pb2_module.OddsUpdatedEvent(
        event_id=event_id,
        sport=sport,
        home_team=home_team,
        away_team=away_team,
        home_odds=home_odds,
        away_odds=away_odds,
        draw_odds=draw_odds,
        updated_at=updated_at,
    )
    return msg.SerializeToString()
