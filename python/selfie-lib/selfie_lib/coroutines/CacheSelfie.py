from collections.abc import Awaitable
from typing import Callable, TypeVar

from selfie_lib.CacheSelfie import CacheSelfie
from selfie_lib.Roundtrip import Roundtrip
from selfie_lib.SnapshotSystem import DiskStorage

T = TypeVar("T")


async def cache_selfie_suspend(
    disk: DiskStorage,
    roundtrip: Roundtrip[T, str],
    to_cache: Callable[[], Awaitable[T]],
) -> CacheSelfie[T]:
    result = await to_cache()
    return CacheSelfie(disk, roundtrip, lambda: result)
