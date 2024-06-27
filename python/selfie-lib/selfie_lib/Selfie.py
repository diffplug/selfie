from typing import Any, TypeVar, overload

from .Lens import Camera
from .SelfieImplementations import BinarySelfie, DiskSelfie, ReprSelfie, StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem

T = TypeVar("T")


@overload
def expect_selfie(actual: str) -> StringSelfie: ...


@overload
def expect_selfie(actual: Snapshot) -> StringSelfie: ...


@overload
def expect_selfie(actual: bytes) -> BinarySelfie: ...


@overload
def expect_selfie(actual: T) -> ReprSelfie[T]: ...


@overload
def expect_selfie(actual: T, camera: Camera[T]) -> StringSelfie: ...


def expect_selfie(actual: Any, camera: Any = None) -> DiskSelfie:
    disk_storage = _selfieSystem().disk_thread_local()
    if camera is not None:
        return StringSelfie(camera.snapshot(actual), disk_storage)
    elif isinstance(actual, str):
        return StringSelfie(Snapshot.of(actual), disk_storage)
    elif isinstance(actual, Snapshot):
        return StringSelfie(actual, disk_storage)
    elif isinstance(actual, bytes):
        return BinarySelfie(Snapshot.of(actual), disk_storage, "")
    else:
        return ReprSelfie(actual, Snapshot.of(repr(actual)), disk_storage)
