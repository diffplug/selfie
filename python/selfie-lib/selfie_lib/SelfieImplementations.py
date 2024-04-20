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
    def __init__(self, actual: Snapshot, disk: DiskStorage, expected: str = ""):
        super().__init__(actual, disk)
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


class BaseSelfie:
    def __init__(self, actual):
        self.actual = actual

    def toBeDidntMatch(self, expected, actual, literal_type):
        call = recordCall()
        snapshot_system = _selfieSystem()
        literal_value = LiteralValue(
            expected=expected,
            actual=f"Expected '{expected}', got '{actual}'",
            format=literal_type,
        )
        snapshot_system.write_inline(literal_value, call)
        raise snapshot_system.fs.assert_failed(
            "Expected value does not match!", expected, actual
        )


class IntSelfie(BaseSelfie):
    def __init__(self, actual: int):
        super().__init__(actual)

    def toBe_TODO(self, unusedArg=None):
        return self.toBeDidntMatch(None, self.actual, LiteralType.LiteralInt)

    def toBe(self, expected: int):
        if self.actual == expected:
            _selfieSystem().checkSrc(self.actual)
        else:
            self.toBeDidntMatch(expected, self.actual, LiteralType.LiteralInt)


class BooleanSelfie(BaseSelfie):
    def __init__(self, actual: bool):
        super().__init__(actual)

    def toBe_TODO(self, unusedArg=None):
        return self.toBeDidntMatch(None, self.actual, LiteralType.LiteralBoolean)

    def toBe(self, expected: bool):
        if self.actual == expected:
            _selfieSystem().checkSrc(self.actual)
        else:
            self.toBeDidntMatch(expected, self.actual, LiteralType.LiteralBoolean)


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

    def toBe_TODO(self) -> str:
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
        return self._expected
