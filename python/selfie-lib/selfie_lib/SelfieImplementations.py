from .Snapshot import Snapshot
from .SnapshotSystem import DiskStorage, _selfieSystem
from .WriteTracker import recordCall as recordCall
from .Literals import LiteralValue, LiteralString as LiteralString


class FluentFacet:
    def __init__(self, actual: Snapshot, disk: DiskStorage):
        self._actual = actual
        self._disk = disk

    def facet(self, facet: str):
        return StringSelfie(self._actual, self._disk, facet)

    def facets(self, *facets: str):
        return StringSelfie(self._actual, self._disk, " ".join(facets))

    def facet_binary(self, facet: str):
        raise NotImplementedError()


class DiskSelfie(FluentFacet):
    def toMatchDisk(self, sub="") -> "DiskSelfie":
        call = recordCall()
        if _selfieSystem().mode.can_write(False, call):
            self._disk.write_disk(self._actual, sub, call)
        else:
            expected = self._disk.read_disk(sub, call)
            if expected != self._actual:
                raise _selfieSystem().fs.assert_failed(
                    "Snapshot mismatch!", expected, self._actual
                )
        return self

    def toMatchDisk_TODO(self, sub="") -> "DiskSelfie":
        call = recordCall()
        if _selfieSystem().mode.can_write(True, call):
            self._disk.write_disk(self._actual, sub, call)
            literal_value = LiteralValue(
                expected=None, actual="toMatchDisk_TODO", format=LiteralString()
            )
            _selfieSystem().write_inline(literal_value, call)
        else:
            raise _selfieSystem().fs.assert_failed(
                "Can't call `toMatchDisk_TODO` in readonly mode!"
            )
        return self


class StringSelfie(DiskSelfie):
    def __init__(self, actual: Snapshot, disk: DiskStorage, expected: str):
        super().__init__(actual, disk)
        self._expected = expected

    def toBe(self, expected: str) -> str:
        result = self._expected
        if result != expected:
            raise _selfieSystem().fs.assert_failed(
                "Expected value does not match!", expected, result
            )
        return result

    def toBe_TODO(self) -> str:
        call = recordCall()
        if _selfieSystem().mode.can_write(True, call):
            literal_value = LiteralValue(
                expected=None,
                actual="TODO: Match expected string",
                format=LiteralString(),
            )
            _selfieSystem().write_inline(literal_value, call)
            return self._expected
        else:
            raise _selfieSystem().fs.assert_failed(
                "Can't call `toBe_TODO` in readonly mode!"
            )
