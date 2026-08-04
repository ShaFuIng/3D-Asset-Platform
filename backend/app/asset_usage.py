import threading
import uuid
from contextlib import AbstractContextManager
from dataclasses import dataclass


@dataclass(frozen=True)
class AssetUse:
    asset_id: str
    owner: str
    reason: str


class AssetUsageLease(AbstractContextManager):
    def __init__(self, guard: "AssetUsageGuard", lease_id: str, asset_ids: tuple[str, ...]) -> None:
        self._guard = guard
        self._lease_id = lease_id
        self._asset_ids = asset_ids
        self._released = False

    def __enter__(self) -> "AssetUsageLease":
        return self

    def __exit__(self, *_exc) -> None:
        self.release()

    def release(self) -> None:
        if self._released:
            return
        self._guard.release(self._lease_id, self._asset_ids)
        self._released = True


class AssetUsageGuard:
    def __init__(self) -> None:
        self._uses: dict[str, dict[str, AssetUse]] = {}
        self._lock = threading.RLock()

    def acquire_many(self, asset_ids: list[str] | tuple[str, ...], *, owner: str, reason: str) -> AssetUsageLease:
        lease_id = str(uuid.uuid4())
        unique_asset_ids = tuple(sorted(set(asset_ids)))
        with self._lock:
            for asset_id in unique_asset_ids:
                self._uses.setdefault(asset_id, {})[lease_id] = AssetUse(
                    asset_id=asset_id,
                    owner=owner,
                    reason=reason,
                )
        return AssetUsageLease(self, lease_id, unique_asset_ids)

    def acquire(self, asset_id: str, *, owner: str, reason: str) -> AssetUsageLease:
        return self.acquire_many([asset_id], owner=owner, reason=reason)

    def release(self, lease_id: str, asset_ids: tuple[str, ...]) -> None:
        with self._lock:
            for asset_id in asset_ids:
                owners = self._uses.get(asset_id)
                if owners is None:
                    continue
                owners.pop(lease_id, None)
                if not owners:
                    self._uses.pop(asset_id, None)

    def is_in_use(self, asset_id: str) -> bool:
        return bool(self.get_uses(asset_id))

    def get_uses(self, asset_id: str) -> list[AssetUse]:
        with self._lock:
            return list(self._uses.get(asset_id, {}).values())
