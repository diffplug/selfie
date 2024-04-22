from .SelfieImplementations import StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem

from typing import Union


def expect_selfie(actual: Union[str, int]) -> "StringSelfie":
    if isinstance(actual, int):
        raise NotImplementedError()
    elif isinstance(actual, str):
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().disk_thread_local()
        return StringSelfie(snapshot, diskStorage)
    else:
        raise NotImplementedError()
