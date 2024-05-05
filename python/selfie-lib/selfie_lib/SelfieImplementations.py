import base64
from abc import ABC, abstractmethod
from itertools import chain
from typing import Any, List, Optional

from .Literals import (
    LiteralFormat,
    LiteralRepr,
    LiteralString,
    LiteralValue,
    TodoStub,
)
from .Snapshot import Snapshot
from .SnapshotFile import SnapshotFile
from .SnapshotSystem import DiskStorage, Mode, SnapshotSystem, _selfieSystem
from .WriteTracker import recordCall as recordCall


class ReprSelfie[T]:
    def __init__(self, actual: T):
        self.actual = actual

    def to_be_TODO(self, unused_arg: Optional[T] = None) -> T:
        return _toBeDidntMatch(None, self.actual, LiteralRepr())

    def to_be(self, expected: T) -> T:
        if self.actual == expected:
            return _checkSrc(self.actual)
        else:
            return _toBeDidntMatch(expected, self.actual, LiteralRepr())


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
            _assertEqual(self.disk.read_disk(sub, call), self.actual, _selfieSystem())
        return self

    def to_match_disk_TODO(self, sub: str = "") -> "DiskSelfie":
        call = recordCall(False)
        if _selfieSystem().mode.can_write(True, call, _selfieSystem()):
            self.disk.write_disk(self.actual, sub, call)
            _selfieSystem().write_inline(TodoStub.to_match_disk.create_literal(), call)
            return self
        else:
            raise _selfieSystem().fs.assert_failed(
                "Can't call `toMatchDisk_TODO` in {} mode!".format(Mode.readonly)
            )

    def facet(self, facet: str) -> "StringFacet":
        raise NotImplementedError()

    def facets(self, *facets: str) -> "StringFacet":
        raise NotImplementedError()

    def facet_binary(self, facet: str) -> "BinaryFacet":
        raise NotImplementedError()


class StringSelfie(DiskSelfie, StringFacet, ReprSelfie[str]):
    def __init__(
        self,
        actual: Snapshot,
        disk: DiskStorage,
        only_facets: Optional[List[str]] = None,
    ):
        super().__init__(actual, disk)
        self.only_facets = only_facets

        if self.only_facets is not None:
            assert all(
                facet == "" or facet in actual.facets for facet in self.only_facets
            ), f"The following facets were not found in the snapshot: {[facet for facet in self.only_facets if actual.subject_or_facet_maybe(facet) is None]}\navailable facets are: {list(actual.facets.keys())}"
            assert (
                len(self.only_facets) > 0
            ), "Must have at least one facet to display, this was empty."
            if "" in self.only_facets:
                assert (
                    self.only_facets.index("") == 0
                ), f'If you\'re going to specify the subject facet (""), you have to list it first, this was {self.only_facets}'

    def to_match_disk(self, sub: str = "") -> "StringSelfie":
        super().to_match_disk(sub)
        return self

    def to_match_disk_TODO(self, sub: str = "") -> "StringSelfie":
        super().to_match_disk_TODO(sub)
        return self

    def __actual(self) -> str:
        if not self.actual.facets or (self.only_facets and len(self.only_facets) == 1):
            # single value doesn't have to worry about escaping at all
            only_value = self.actual.subject_or_facet(
                self.only_facets[0] if self.only_facets else ""
            )
            if only_value.is_binary:
                return (
                    base64.b64encode(only_value.value_binary())
                    .decode()
                    .replace("\r", "")
                )
            else:
                return only_value.value_string()
        else:
            return _serializeOnlyFacets(
                self.actual, self.only_facets or [""] + list(self.actual.facets.keys())
            )

    def to_be_TODO(self, unused_arg: Any = None) -> str:
        return _toBeDidntMatch(None, self.__actual(), LiteralString())

    def to_be(self, expected: str) -> str:
        actual_string = self.__actual()

        # Check if expected is a string
        if not isinstance(expected, str):
            raise TypeError("Expected value must be a string")

        if actual_string == expected:
            return _checkSrc(actual_string)
        else:
            return _toBeDidntMatch(
                expected,
                actual_string,
                LiteralString(),
            )


def _checkSrc[T](value: T) -> T:
    _selfieSystem().mode.can_write(False, recordCall(True), _selfieSystem())
    return value


def _toBeDidntMatch[T](expected: Optional[T], actual: T, format: LiteralFormat[T]) -> T:
    call = recordCall(False)
    writable = _selfieSystem().mode.can_write(expected is None, call, _selfieSystem())
    if writable:
        _selfieSystem().write_inline(LiteralValue(expected, actual, format), call)
        return actual
    else:
        if expected is None:
            raise _selfieSystem().fs.assert_failed(
                f"Can't call `toBe_TODO` in {Mode.readonly} mode!"
            )
        else:
            raise _selfieSystem().fs.assert_failed(
                _selfieSystem().mode.msg_snapshot_mismatch(), expected, actual
            )


def _assertEqual(
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
            _serializeOnlyFacets(expected, mismatched_keys),
            _serializeOnlyFacets(actual, mismatched_keys),
        )


def _serializeOnlyFacets(snapshot: Snapshot, keys: List[str]) -> str:
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
