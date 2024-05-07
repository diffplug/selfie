from typing import Any, Optional, Protocol, TypeVar, Union, overload

from .CacheSelfie import CacheSelfie
from .RoundTrip import Roundtrip
from .SelfieImplementations import ReprSelfie, StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem

# Declare T as covariant
T = TypeVar("T", covariant=True)


@overload
def expect_selfie(actual: str) -> StringSelfie: ...


# @overload
# def expect_selfie(actual: bytes) -> BinarySelfie: ...  # noqa: ERA001


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
