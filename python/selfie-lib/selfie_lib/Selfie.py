from tracemalloc import Snapshot
from .SelfieImplementations import StringSelfie, IntSelfie, BooleanSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem


def expectSelfie(actual):
    diskStorage = _selfieSystem().diskThreadLocal()
    if isinstance(actual, str):
        snapshot = Snapshot.of(actual)
        return StringSelfie(snapshot, diskStorage, actual)
    elif isinstance(actual, bool):
        snapshot = Snapshot.of(str(actual))  
        return BooleanSelfie(snapshot, diskStorage)
    elif isinstance(actual, int):
        snapshot = Snapshot.of(str(actual))
        return IntSelfie(snapshot, diskStorage)
