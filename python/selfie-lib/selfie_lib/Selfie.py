from typing import Any, TypeVar, Union, overload

from .SelfieImplementations import ReprSelfie, StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem

T = TypeVar("T")


@overload
def expect_selfie(actual: str) -> StringSelfie: ...


@overload
def expect_selfie(actual: Snapshot) -> StringSelfie: ...


@overload
def expect_selfie(actual: T) -> ReprSelfie[T]: ...


def expect_selfie(
    actual: Any,
) -> Union[StringSelfie, ReprSelfie]:
    if isinstance(actual, str):
        return StringSelfie(Snapshot.of(actual), _selfieSystem().disk_thread_local())
    elif isinstance(actual, Snapshot):
        return StringSelfie(actual, _selfieSystem().disk_thread_local())
    else:
        return ReprSelfie(actual)
