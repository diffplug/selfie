import asyncio
import pytest
from typing import Optional

from selfie_lib.coroutines.CacheSelfie import cache_selfie_suspend
from selfie_lib.Roundtrip import Roundtrip
from selfie_lib.SnapshotSystem import DiskStorage, Snapshot
from selfie_lib.WriteTracker import CallStack


class TestDiskStorage(DiskStorage):
    def read_disk(self, sub: str, call: CallStack) -> Optional[Snapshot]:
        return None

    def write_disk(self, actual: Snapshot, sub: str, call: CallStack):
        pass

    def keep(self, sub_or_keep_all: Optional[str]):
        pass


async def async_value() -> str:
    await asyncio.sleep(0.1)
    return "test_value"


@pytest.mark.asyncio
async def test_cache_selfie_suspend():
    disk = TestDiskStorage()
    roundtrip = Roundtrip[str, str]()

    cache = await cache_selfie_suspend(disk, roundtrip, async_value)

    assert cache.generator() == "test_value"
