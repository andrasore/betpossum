import os
import platform
import shutil
import socket
import stat
import subprocess
import tempfile
import time
import urllib.request
import zipfile

import pytest

from ledger import LedgerClient

TB_VERSION = "0.17.3"
TB_PORT = 5999
TB_ADDRESS = f"127.0.0.1:{TB_PORT}"

_ARCH_MAP = {"x86_64": "x86_64", "aarch64": "aarch64"}
_arch = _ARCH_MAP.get(platform.machine(), "x86_64")
_TB_DOWNLOAD_URL = (
    f"https://github.com/tigerbeetle/tigerbeetle/releases/download/"
    f"{TB_VERSION}/tigerbeetle-{_arch}-linux.zip"
)

_TB_BIN_DIR = os.path.join(os.path.dirname(__file__), ".tb_bin")
_TB_BIN = os.path.join(_TB_BIN_DIR, "tigerbeetle")


def _ensure_binary() -> None:
    if os.path.exists(_TB_BIN):
        return
    os.makedirs(_TB_BIN_DIR, exist_ok=True)
    zip_path = os.path.join(_TB_BIN_DIR, "tb.zip")
    print(f"\nDownloading TigerBeetle {TB_VERSION} …")
    urllib.request.urlretrieve(_TB_DOWNLOAD_URL, zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extract("tigerbeetle", _TB_BIN_DIR)
    os.chmod(_TB_BIN, os.stat(_TB_BIN).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    os.remove(zip_path)


def _wait_for_port(port: int, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"TigerBeetle did not open port {port} within {timeout}s")


@pytest.fixture()
def ledger():
    _ensure_binary()
    data_dir = tempfile.mkdtemp(prefix="tb_test_")
    data_file = os.path.join(data_dir, "0_0.tigerbeetle")
    proc = None
    try:
        subprocess.run(
            [_TB_BIN, "format", "--cluster=0", "--replica=0", "--replica-count=1", data_file],
            check=True,
            capture_output=True,
        )
        proc = subprocess.Popen(
            [_TB_BIN, "start", f"--addresses=0.0.0.0:{TB_PORT}", data_file],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _wait_for_port(TB_PORT)
        client = LedgerClient(TB_ADDRESS)
        try:
            yield client
        finally:
            client.close()
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)
