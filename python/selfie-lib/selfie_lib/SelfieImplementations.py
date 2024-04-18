from .Snapshot import Snapshot
from .SnapshotFile import SnapshotFile
from .SnapshotSystem import DiskStorage, SnapshotSystem, _selfieSystem, Mode
from .WriteTracker import recordCall as recordCall
from .Literals import LiteralValue, LiteralString, TodoStub


from abc import ABC, abstractmethod
from typing import Any, List, Optional
from itertools import chain


class FluentFacet(ABC):
    @abstractmethod
    def facet(self, facet: str) -> "StringFacet":
        """Extract a single facet from a snapshot in order to do an inline snapshot."""
        pass

    @abstractmethod
    def facets(self, *facets: str) -> "StringFacet":
        """Extract multiple facets from a snapshot in order to do an inline snapshot."""
        pass

    @abstractmethod
    def facet_binary(self, facet: str) -> "BinaryFacet":
        pass


class StringFacet(FluentFacet, ABC):
    @abstractmethod
    def to_be(self, expected: str) -> str:
        pass

    def to_be_TODO(self, unused_arg: Any = None) -> str:
        return self.to_be_TODO()


class BinaryFacet(FluentFacet, ABC):
    @abstractmethod
    def to_be_base64(self, expected: str) -> bytes:
        pass

    def to_be_base64_TODO(self, unused_arg: Any = None) -> bytes:
        return self.to_be_base64_TODO()

    @abstractmethod
    def to_be_file(self, subpath: str) -> bytes:
        pass

    @abstractmethod
    def to_be_file_TODO(self, subpath: str) -> bytes:
        pass


class DiskSelfie(FluentFacet):
    def __init__(self, actual: Snapshot, disk: DiskStorage):
        self.actual = actual
        self.disk = disk

    def to_match_disk(self, sub: str = "") -> "DiskSelfie":
        call = recordCall(False)
        if _selfieSystem().mode.can_write(False, call, _selfieSystem()):
            self.disk.write_disk(self.actual, sub, call)
        else:
            assertEqual(self.disk.read_disk(sub, call), self.actual, _selfieSystem())
        return self

    def to_match_disk_TODO(self, sub: str = "") -> "DiskSelfie":
        call = recordCall(False)
        if _selfieSystem().mode.can_write(True, call, _selfieSystem()):
            self.disk.write_disk(self.actual, sub, call)
            _selfieSystem().write_inline(TodoStub.toMatchDisk.create_literal(), call)
            return self
        else:
            raise _selfieSystem().fs.assert_failed(
                "Can't call `toMatchDisk_TODO` in {} mode!".format(Mode.readonly)
            )

    def facet(self, facet: str) -> "StringFacet":
        raise NotImplementedError()

    def facets(self, *facets: str) -> "StringFacet":
        raise NotImplementedError()

    def facetBinary(self, facet: str) -> "BinaryFacet":
        raise NotImplementedError()


class StringSelfie(DiskSelfie):
    def __init__(self, actual: Snapshot, disk: DiskStorage):
        super().__init__(actual, disk)

    def to_be(self, expected: str) -> str:
        result = self._actual._subject.value_string()  # TODO handle facets
        if result != expected:
            raise _selfieSystem().fs.assert_failed(
                "Expected value does not match!", expected, result
            )
        return result

    def to_be_TODO(self) -> str:
        call = recordCall()
        snapshot_system = _selfieSystem()
        if snapshot_system.mode.can_write(True, call, _selfieSystem()):
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
                actual=f"TODO: Expected '{self._actual}', got '{actual_value}'",
                format=LiteralString(),
            )
            snapshot_system.write_inline(literal_value, call)
        else:
            raise snapshot_system.fs.assert_failed(
                "Can't call `toBe_TODO` in readonly mode!"
            )
        return self._actual._subject.value_string()  # TODO handle facets


def assertEqual(
    expected: Optional[Snapshot], actual: Snapshot, storage: SnapshotSystem
):
    if expected is None:
        raise storage.fs.assert_failed(storage.mode.msg_snapshot_not_found())
    elif expected == actual:
        return
    else:
        mismatched_keys = sorted(
            filter(
                lambda facet: expected.subject_or_facet_maybe(facet)
                != actual.subject_or_facet_maybe(facet),
                chain(
                    [""],
                    expected.facets.keys(),
                    (
                        facet
                        for facet in actual.facets.keys()
                        if facet not in expected.facets
                    ),
                ),
            )
        )
        raise storage.fs.assert_failed(
            storage.mode.msg_snapshot_mismatch(),
            serializeOnlyFacets(expected, mismatched_keys),
            serializeOnlyFacets(actual, mismatched_keys),
        )


def serializeOnlyFacets(snapshot: Snapshot, keys: List[str]) -> str:
    writer = []
    for key in keys:
        if not key:
            SnapshotFile.writeEntry(writer, "", None, snapshot.subject_or_facet(key))
        else:
            value = snapshot.subject_or_facet(key)
            if value is not None:
                SnapshotFile.writeEntry(writer, "", key, value)

    EMPTY_KEY_AND_FACET = "╔═  ═╗\n"
    writer_str = "".join(writer)

    if writer_str.startswith(EMPTY_KEY_AND_FACET):
        # this codepath is triggered by the `key.isEmpty()` line above
        return writer_str[len(EMPTY_KEY_AND_FACET) : -1]
    else:
        return writer_str[:-1]
