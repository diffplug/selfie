from typing import TypeVar, Generic, Protocol, Union
from .SelfieImplementations import StringSelfie, IntSelfie, BooleanSelfie
from .SnapshotSystem import _selfieSystem, SnapshotSystem
from .Snapshot import Snapshot
from .CacheSelfie import CacheSelfie
from .RoundTrip import Roundtrip

# Declare T as covariant
T = TypeVar("T", covariant=True)


# Define Cacheable as a generic protocol
class Cacheable(Protocol[T]):
    def __call__(self) -> T:
        """Method to get the cached object."""
        raise NotImplementedError


def get_system() -> SnapshotSystem:
    return _selfieSystem()


def expect_selfie(actual: Union[str, int, bool]):
    if isinstance(actual, int):
        return IntSelfie(actual)
    elif isinstance(actual, str):
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().disk_thread_local()
        return StringSelfie(snapshot, diskStorage)
    elif isinstance(actual, bool):
        return BooleanSelfie(actual)
    else:
        raise NotImplementedError()


def cache_selfie_string(to_cache: Cacheable[str]) -> CacheSelfie[str]:
    """Create a CacheSelfie instance for caching strings with identity transformation."""
    identity_roundtrip = Roundtrip.identity()
    deferred_disk_storage = get_system().disk_thread_local()
    return CacheSelfie(deferred_disk_storage, identity_roundtrip, to_cache)


def cache_selfie_generic(
    roundtrip: Roundtrip[T, str], to_cache: Cacheable[T]
) -> CacheSelfie[T]:
    """Create a CacheSelfie instance for caching generic objects with specified roundtrip."""
    deferred_disk_storage = get_system().disk_thread_local()
    return CacheSelfie(deferred_disk_storage, roundtrip, to_cache)
