"""Deleted cards kept in memory for a few seconds so "되돌리기" can bring them back (§8).
Never written to disk: after the window the delete is final."""

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from aiplot.db.deletion import Snapshot

RESTORE_SECONDS = 10.0


@dataclass(frozen=True)
class Deleted:
    work_id: str
    snapshot: Snapshot
    expires: float
    restore_until: str


class Trash:
    def __init__(
        self,
        seconds: float = RESTORE_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.seconds = seconds
        self.clock = clock
        self.now = now
        self._items: dict[str, Deleted] = {}

    def _purge(self) -> None:
        now = self.clock()
        for card_id in [k for k, v in self._items.items() if v.expires <= now]:
            del self._items[card_id]

    def put(self, card_id: str, work_id: str, snapshot: Snapshot) -> Deleted:
        self._purge()
        until = self.now() + timedelta(seconds=self.seconds)
        deleted = Deleted(
            work_id=work_id,
            snapshot=snapshot,
            expires=self.clock() + self.seconds,
            restore_until=until.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        )
        self._items[card_id] = deleted
        return deleted

    def get(self, card_id: str) -> Deleted | None:
        self._purge()
        return self._items.get(card_id)

    def drop(self, card_id: str) -> None:
        self._items.pop(card_id, None)
