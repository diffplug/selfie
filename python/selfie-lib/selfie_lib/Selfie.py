from tracemalloc import Snapshot
from .SelfieImplementations import StringSelfie, IntSelfie, BooleanSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem


def expectSelfie(actual):
    if isinstance(actual, str):
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().diskThreadLocal()
        return StringSelfie(snapshot, diskStorage, actual)
    elif isinstance(actual, int):
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().diskThreadLocal()
        return IntSelfie(snapshot, diskStorage)
    elif isinstance(actual, bool):
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().diskThreadLocal()
        return BooleanSelfie(snapshot, diskStorage)
