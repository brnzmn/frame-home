"""A small client for the TV's art channel, written against what this TV actually does.

Observed on the Frame Pro 2025 (art API 5.0.1.0):
- the art service answers only while Art Mode is on (the Art app is in front);
- it may send art events before the channel's own connect frame, which the samsungframetv
  classes treat as a failed connection, hence this client;
- replies carry the request's `request_id` and the request name in `event`.
"""
from __future__ import annotations

import asyncio
import base64
import json
import ssl
import uuid

import websockets

from tv import TOKEN_FILE, tv_ip


class ArtError(RuntimeError):
    pass


class ArtChannel:
    def __init__(self, name: str = "Frame Home") -> None:
        token = TOKEN_FILE.read_text().strip()
        b64 = base64.b64encode(name.encode()).decode()
        self.url = f"wss://{tv_ip()}:8002/api/v2/channels/com.samsung.art-app?name={b64}&token={token}"
        self.events: list[dict] = []
        self._pending: dict[str, asyncio.Future] = {}
        self._ready = asyncio.Event()
        self._ws = None
        self._reader = None

    async def __aenter__(self) -> "ArtChannel":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # the TV presents its own certificate on the home network
        self._ws = await websockets.connect(self.url, ssl=ctx, max_size=None)
        self._reader = asyncio.create_task(self._read())
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=10)
        except asyncio.TimeoutError as exc:
            await self.__aexit__(None, None, None)
            raise ArtError("the TV did not open the art channel (not paired, or the TV is off)") from exc
        return self

    async def __aexit__(self, *exc) -> None:
        if self._reader:
            self._reader.cancel()
        if self._ws:
            await self._ws.close()

    async def _read(self) -> None:
        async for frame in self._ws:
            if isinstance(frame, bytes):
                continue
            msg = json.loads(frame)
            event = msg.get("event")
            if event == "ms.channel.ready":
                self._ready.set()
                continue
            if event != "d2d_service_message":
                continue
            data = msg.get("data")
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except ValueError:
                    continue
            if not isinstance(data, dict):
                continue
            future = self._pending.pop(data.get("request_id") or data.get("id") or "", None)
            if future and not future.done():
                future.set_result(data)
            else:
                self.events.append(data)

    async def request(self, name: str, timeout: float = 8, **fields) -> dict:
        """Send one art request and return the TV's reply. Raises ArtError on no reply or an error reply."""
        rid = str(uuid.uuid4())
        data = {"request": name, "id": rid, "request_id": rid, **fields}
        future = asyncio.get_running_loop().create_future()
        self._pending[rid] = future
        await self._ws.send(json.dumps({"method": "ms.channel.emit", "params": {"event": "art_app_request", "to": "host", "data": json.dumps(data)}}))
        try:
            reply = await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(rid, None)
            raise ArtError(f"no reply to {name} (the art service only answers while Art Mode is on)") from exc
        if reply.get("event") == "error":
            raise ArtError(f"{name}: error {reply.get('error_code')} {reply.get('request_data', '')}")
        return reply

    async def art_mode_on(self) -> bool:
        try:
            return (await self.request("get_artmode_status", timeout=4)).get("value") == "on"
        except ArtError:
            return False

    async def images(self, category: str | None = None) -> list[dict]:
        reply = await self.request("get_content_list", timeout=20, category=category)
        items = reply.get("content_list", [])
        return json.loads(items) if isinstance(items, str) else items

    async def mats(self) -> tuple[list[str], list[str]]:
        reply = await self.request("get_matte_list")
        types = [t.get("matte_type") for t in json.loads(reply.get("matte_type_list", "[]"))]
        colours = [c.get("color") for c in json.loads(reply.get("matte_color_list", "[]"))]
        return types, colours

    async def change_mat(self, content_id: str, matte_id: str | None = None, portrait_matte_id: str | None = None) -> dict:
        fields = {"content_id": content_id}
        if matte_id:
            fields["matte_id"] = matte_id
        if portrait_matte_id:
            fields["portrait_matte_id"] = portrait_matte_id
        return await self.request("change_matte", **fields)
