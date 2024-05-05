from typing import Any, TypeVar, Optional, Protocol, Union, overload
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


@overload
def cache_selfie(to_cache: Cacheable[str]) -> CacheSelfie[str]: ...


@overload
def cache_selfie(
    to_cache: Cacheable[T], roundtrip: Roundtrip[T, str]
) -> CacheSelfie[T]: ...


def cache_selfie(
    to_cache: Union[Cacheable[str], Cacheable[T]],
    roundtrip: Optional[Roundtrip[T, str]] = None,
) -> Union[CacheSelfie[str], CacheSelfie[T]]:
    if roundtrip is None:
        # the cacheable better be a string!
        return cache_selfie(to_cache, Roundtrip.identity())  # type: ignore
    elif isinstance(roundtrip, Roundtrip) and to_cache is not None:
        deferred_disk_storage = _selfieSystem().disk_thread_local()
        return CacheSelfie(deferred_disk_storage, roundtrip, to_cache)
    else:
        raise TypeError("Invalid arguments provided to cache_selfie")
