from tkinter import NO
from .SelfieImplementations import StringSelfie
from .Snapshot import Snapshot
from .SnapshotSystem import _selfieSystem

from typing import Union


def expect_selfie(actual: Union[str, int]) -> "StringSelfie":
    if actual is int:
        raise NotImplementedError()
    elif actual is str:
        snapshot = Snapshot.of(actual)
        diskStorage = _selfieSystem().disk_thread_local()
        return StringSelfie(snapshot, diskStorage)
    else:
        raise NotImplementedError()
