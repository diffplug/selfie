from tracemalloc import Snapshot
from .SelfieImplementations import StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem


def expectSelfie(actual: str) -> "StringSelfie":
    snapshot = Snapshot.of(actual)
    diskStorage = _selfieSystem().diskThreadLocal()
    return StringSelfie(snapshot, diskStorage, actual)
