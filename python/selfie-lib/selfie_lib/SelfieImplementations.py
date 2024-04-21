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


class BaseSelfie:
    def __init__(self, snapshot):
        self._snapshot = snapshot

    def toBe_TODO(self):
        print(f"TODO: Implement check for {self._snapshot.subject_or_facet('')}")

    def toBeDidntMatch(self, expected, literal_type):
        call = recordCall()
        snapshot_system = _selfieSystem()
        literal_value = LiteralValue(
            expected=expected,
            actual=f"Expected '{expected}', got '{self._snapshot.subject_or_facet("")}'",
            format=literal_type,
        )
        snapshot_system.write_inline(literal_value, call)
        raise snapshot_system.fs.assert_failed(
            "Expected value does not match!",
            expected,
            self._snapshot.subject_or_facet(""),
        )


class DiskSelfie(FluentFacet, BaseSelfie):
    def __init__(self, snapshot, disk: DiskStorage, expected: str = ""):
        FluentFacet.__init__(self, snapshot, disk)
        BaseSelfie.__init__(self, snapshot)
        self._expected = expected

    def toMatchDisk(self, sub="") -> "DiskSelfie":
        call = recordCall()
        snapshot_system = _selfieSystem()
        if snapshot_system.mode.can_write(False, call):
            snapshot_system.diskThreadLocal().write_disk(self._actual, sub, call)
        else:
            expected = snapshot_system.diskThreadLocal().read_disk(sub, call)
            if expected != self._actual:
                raise snapshot_system.fs.assert_failed(
                    "Snapshot mismatch!", expected, self._actual
                )
        return self

    def toMatchDisk_TODO(self, sub="") -> "DiskSelfie":
        call = recordCall()
        snapshot_system = _selfieSystem()
        if snapshot_system.mode.can_write(True, call):
            self._disk.write_disk(self._actual, sub, call)
            actual_snapshot_value = self._actual.subject_or_facet_maybe(sub)
            if actual_snapshot_value is None:
                actual_value = "None"
            else:
                actual_value = (
                    actual_snapshot_value.value_string()
                    if not actual_snapshot_value.is_binary
                    else "binary data"
                )
            literal_value = LiteralValue(
                expected=None,
                actual=f"TODO: Expected '{self._expected}', got '{actual_value}'",
                format=LiteralString(),
            )
            snapshot_system.write_inline(literal_value, call)
        else:
            raise snapshot_system.fs.assert_failed(
                "Can't call `toMatchDisk_TODO` in readonly mode!"
            )
        return self


class LiteralType:
    LiteralInt = "int"
    LiteralBoolean = "bool"
    LiteralString = "str"


class IntSelfie(DiskSelfie):
    def __init__(self, snapshot, disk: DiskStorage):
        super().__init__(snapshot, disk)

    def toBe(self, expected: int):
        actual = int(self._snapshot.subject_or_facet("")._value)
        if actual == expected:
            _selfieSystem().checkSrc(actual)
        else:
            self.toBeDidntMatch(expected, LiteralType.LiteralInt)


class BooleanSelfie(DiskSelfie):
    def __init__(self, snapshot, disk: DiskStorage):
        super().__init__(snapshot, disk)

    def toBe(self, expected: bool):
        actual = self._snapshot.subject_or_facet("")._value.lower() == "true"
        if actual == expected:
            _selfieSystem().checkSrc(actual)
        else:
            self.toBeDidntMatch(expected, LiteralType.LiteralBoolean)


class StringSelfie(DiskSelfie):
    def __init__(self, actual: Snapshot, disk: DiskStorage, expected: str):
        super().__init__(actual, disk, expected)

    def toBe(self, expected: str) -> str:
        result = self._expected
        if result != expected:
            raise _selfieSystem().fs.assert_failed(
                "Expected value does not match!", expected, result
            )
        return result

    def toBe_TODO(self):
        call = recordCall()
        snapshot_system = _selfieSystem()
        if snapshot_system.mode.can_write(True, call):
            actual_snapshot_value = self._actual.subject_or_facet_maybe("")
            if actual_snapshot_value is None:
                actual_value = "None"
            else:
                actual_value = (
                    actual_snapshot_value.value_string()
                    if not actual_snapshot_value.is_binary
                    else "binary data"
                )
            literal_value = LiteralValue(
                expected=None,
                actual=f"TODO: Expected '{self._expected}', got '{actual_value}'",
                format=LiteralString(),
            )
            snapshot_system.write_inline(literal_value, call)
        else:
            raise snapshot_system.fs.assert_failed(
                "Can't call `toBe_TODO` in readonly mode!"
            )
