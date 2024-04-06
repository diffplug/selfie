from socketserver import ThreadingUnixStreamServer
from .Snapshot import Snapshot
from .SnapshotSystem import DiskStorage, SnapshotSystem
from .WriteTracker import recordCall


class FluentFacet:
    def facet(self, facet: str):
        return StringSelfie(self._actual, self._disk, facet)

    def facets(self, *facets: str):
        return StringSelfie(self._actual, self._disk, facets)

    def facet_binary(self, facet: str):
        raise NotImplementedError() 


class DiskSelfie(FluentFacet):
    def __init__(self, actual: Snapshot, disk: DiskStorage):
        self._actual = actual
        self._disk = disk

    def toMatchDisk(self, sub="") -> "DiskSelfie":
        call = self._disk.recordCall(False)
        if _selfieSystem().mode.can_write(False, call):
            self._disk.write_disk(self._actual, sub, call)
        else:
            expected = self._disk.read_disk(sub, call)
            if expected != self._actual:
                raise _selfieSystem().fs.assert_failed("Snapshot mismatch!", expected, self._actual)
        return self

    def toMatchDisk_TODO(self, sub="") -> "DiskSelfie":
        call = self._disk.recordCall(False)
        if _selfieSystem().mode.can_write(True, call):
            self._disk.write_disk(self._actual, sub, call)
            _selfieSystem().write_inline("toMatchDisk_TODO", call)
            return self
        else:
            raise _selfieSystem().fs.assert_failed(f"Can't call `toMatchDisk_TODO` in readonly mode!")


class StringSelfie(DiskSelfie):
    def __init__(self, actual: Snapshot, disk: DiskStorage, expected: str):
        super().__init__(actual, disk)
        self._expected = expected

    def toBe(self, expected: str) -> str:
        if isinstance(self._expected, list):
            result = ' '.join(self._expected)
        else:
            result = self._expected
        if result != expected:
            raise _selfieSystem().fs.assert_failed("Expected value does not match!", expected, result)
        return result

    def toBe_TODO(self) -> str:
        call = self._disk.recordCall(False)
        if _selfieSystem().mode.can_write(True, call):
            _selfieSystem().write_inline("TODO: Match expected string", call)
            return self._expected  
        else:
            raise _selfieSystem().fs.assert_failed("Can't call `toBe_TODO` in readonly mode!")
    

selfieSystem = None 


def _initSelfieSystem(system: SnapshotSystem):
    global selfieSystem
    if selfieSystem is not None:
        raise Exception("Selfie system already initialized")
    selfieSystem = system


def _selfieSystem() -> "SnapshotSystem":
    global selfieSystem 
    if selfieSystem is None:
        raise Exception("Selfie system not initialized")
    return selfieSystem
