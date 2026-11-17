"""Raw look at the TV's art channel: prints every frame the TV sends and tries a few requests.

Diagnostic only, read-only requests. Client ids are shortened in the output.

  raw.py [seconds]     default 25
"""
from __future__ import annotations

import asyncio
import base64
import json
import ssl
import sys
import time
import uuid

import websockets

from tv import TOKEN_FILE, tv_ip

REQUESTS = ["api_version", "get_artmode_status", "get_matte_list", "get_current_artwork", "get_device_info"]


def shorten_ids(value):
    """Keep the shape of a frame but cut long ids down to four characters."""
    if isinstance(value, dict):
        # The TV echoes each client's pairing token in its connect frame; never print it.
        value = {k: ("(hidden)" if k == "token" else v) for k, v in value.items()}
        return {k: (str(v)[:4] + "…" if k in ("id", "from", "clientId", "uuid") and isinstance(v, str) and len(v) > 8 else shorten_ids(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [shorten_ids(v) for v in value]
    return value


async def main(seconds: float) -> None:
    token = TOKEN_FILE.read_text().strip()
    name = base64.b64encode(b"Frame Home").decode()
    url = f"wss://{tv_ip()}:8002/api/v2/channels/com.samsung.art-app?name={name}&token={token}"
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # the TV uses its own certificate on the home network
    start = time.time()

    def stamp() -> str:
        return f"{time.time() - start:5.1f}"

    async with websockets.connect(url, ssl=ctx) as ws:
        host_id = None

        async def sender() -> None:
            await asyncio.sleep(2)
            for request in REQUESTS:
                rid = str(uuid.uuid4())
                data = {"request": request, "id": rid, "request_id": rid}
                await ws.send(json.dumps({"method": "ms.channel.emit", "params": {"event": "art_app_request", "to": "host", "data": json.dumps(data)}}))
                print(f"{stamp()} sent {request} to host")
                await asyncio.sleep(2)
            if host_id:
                rid = str(uuid.uuid4())
                data = {"request": "get_artmode_status", "id": rid, "request_id": rid}
                await ws.send(json.dumps({"method": "ms.channel.emit", "params": {"event": "art_app_request", "to": host_id, "data": json.dumps(data)}}))
                print(f"{stamp()} sent get_artmode_status to the host's own id")

        task = asyncio.create_task(sender())
        try:
            while time.time() - start < seconds:
                try:
                    frame = await asyncio.wait_for(ws.recv(), timeout=1)
                except asyncio.TimeoutError:
                    continue
                if isinstance(frame, bytes):
                    print(f"{stamp()} binary frame, {len(frame)} bytes")
                    continue
                msg = json.loads(frame)
                event = msg.get("event")
                data = msg.get("data")
                if isinstance(data, str):
                    try:
                        data = json.loads(data)
                    except ValueError:
                        pass
                if event == "ms.channel.connect" and isinstance(data, dict):
                    clients = data.get("clients", [])
                    for c in clients:
                        if c.get("isHost"):
                            host_id = c.get("id")
                    summary = [{"isHost": c.get("isHost"), "deviceName": c.get("deviceName"), "attributes": c.get("attributes")} for c in clients]
                    print(f"{stamp()} ms.channel.connect: {len(clients)} clients {json.dumps(summary)[:500]}")
                    continue
                print(f"{stamp()} {event} {json.dumps(shorten_ids(data))[:600]}")
        finally:
            task.cancel()


if __name__ == "__main__":
    asyncio.run(main(float(sys.argv[1]) if len(sys.argv) > 1 else 25))
