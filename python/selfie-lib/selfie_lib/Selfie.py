from .SelfieImplementations import StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem


def expectSelfie(actual: str) -> "StringSelfie":
    snapshot = Snapshot.of(actual)
    diskStorage = _selfieSystem().disk_thread_local()
    return StringSelfie(snapshot, diskStorage)
