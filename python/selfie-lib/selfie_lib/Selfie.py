from .SelfieImplementations import StringSelfie, IntSelfie, BooleanSelfie
from .SnapshotSystem import _selfieSystem, SnapshotSystem
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem
from typing import Union


system_instance: Union[SnapshotSystem, None] = None


def get_system() -> SnapshotSystem:
    global system_instance
    if system_instance is None:
        system_instance = _selfieSystem()
    return system_instance


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
