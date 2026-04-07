import asyncio
import json
from collections import defaultdict
from typing import Any, AsyncIterator, DefaultDict

ADMIN_MACHINE_EVENTS_CHANNEL = -999_999


class SessionEventBus:
    """In-process pub/sub for machine-specific session events."""

    def __init__(self) -> None:
        self._subscribers: DefaultDict[int, set[asyncio.Queue[str]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, machine_id: int) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue()
        async with self._lock:
            self._subscribers[machine_id].add(queue)
        return queue

    async def unsubscribe(self, machine_id: int, queue: asyncio.Queue[str]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(machine_id)
            if not subscribers:
                return
            subscribers.discard(queue)
            if not subscribers:
                self._subscribers.pop(machine_id, None)

    async def publish(self, machine_id: int, event_name: str, payload: dict[str, Any]) -> None:
        message = self._format_sse_message(event_name, payload)
        async with self._lock:
            subscribers = list(self._subscribers.get(machine_id, set()))

        for queue in subscribers:
            await queue.put(message)

    async def stream(
        self,
        machine_id: int,
        initial_payload: dict[str, Any] | None,
        initial_event_name: str = "session_status",
        send_initial: bool = True,
        heartbeat_interval: float = 15.0,
    ) -> AsyncIterator[str]:
        queue = await self.subscribe(machine_id)
        try:
            if send_initial and initial_payload is not None:
                yield self._format_sse_message(initial_event_name, initial_payload)
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=heartbeat_interval)
                    yield message
                except asyncio.TimeoutError:
                    yield self._format_sse_message("heartbeat", {"ok": True})
        finally:
            await self.unsubscribe(machine_id, queue)

    def _format_sse_message(self, event_name: str, payload: dict[str, Any]) -> str:
        return f"event: {event_name}\ndata: {json.dumps(payload)}\n\n"


session_event_bus = SessionEventBus()
