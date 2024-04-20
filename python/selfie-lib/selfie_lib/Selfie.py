from tracemalloc import Snapshot
from .SelfieImplementations import StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem


def expectSelfie(actual):
    if isinstance(actual, str):
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().diskThreadLocal()
        return StringSelfie(snapshot, diskStorage, actual)
    elif isinstance(actual, int):
        return IntSelfie(actual)
    elif isinstance(actual, bool):
        return BooleanSelfie(actual)
    else:
        raise ValueError("Unsupported type for Selfie.")

