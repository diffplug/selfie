from typing import TypeVar, Any, Protocol, Union, overload
from .SelfieImplementations import ReprSelfie, StringSelfie
from .SnapshotSystem import _selfieSystem
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


@overload
def expect_selfie(actual: str) -> StringSelfie: ...


# @overload
# def expect_selfie(actual: bytes) -> BinarySelfie: ...


@overload
def expect_selfie[T](actual: T) -> ReprSelfie[T]: ...


def expect_selfie(
    actual: Union[str, Any],
) -> Union[StringSelfie, ReprSelfie]:
    if isinstance(actual, str):
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().disk_thread_local()
        return StringSelfie(snapshot, diskStorage)
    else:
        return ReprSelfie(actual)


def cache_selfie_string(to_cache: Cacheable[str]) -> CacheSelfie[str]:
    """Create a CacheSelfie instance for caching strings with identity transformation."""
    identity_roundtrip = Roundtrip.identity()
    return cache_selfie_generic(identity_roundtrip, to_cache)


def cache_selfie_generic(
    roundtrip: Roundtrip[T, str], to_cache: Cacheable[T]
) -> CacheSelfie[T]:
    """Create a CacheSelfie instance for caching generic objects with specified roundtrip."""
    deferred_disk_storage = _selfieSystem().disk_thread_local()
    return CacheSelfie(deferred_disk_storage, roundtrip, to_cache)
