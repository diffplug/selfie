from .SelfieImplementations import StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem

from typing import Union


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
