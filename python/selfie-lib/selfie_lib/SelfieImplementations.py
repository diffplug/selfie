from socketserver import ThreadingUnixStreamServer
from .Snapshot import Snapshot
from .SnapshotSystem import DiskStorage


class FluentFacet:
    pass


class DiskSelfie(FluentFacet):
    def __init__(self, actual: Snapshot, disk: DiskStorage):
        self._actual = actual
        self._disk = disk

    def toMatchDisk(self, sub="") -> "DiskSelfie":
        raise NotImplementedError()

    def toMatchDisk_TODO(self, sub="") -> "DiskSelfie":
        raise NotImplementedError()


class StringSelfie(DiskSelfie):
    def __init__(self, actual: Snapshot, disk: DiskStorage, expected: str):
        super().__init__(actual, disk)
        self._expected = expected

    def toBe_TODO(self) -> str:
        raise NotImplementedError()

    def toBe(self, expected: str) -> str:
        raise NotImplementedError()
