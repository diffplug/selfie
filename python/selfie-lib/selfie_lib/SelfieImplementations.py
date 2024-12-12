import base64
from abc import ABC, abstractmethod
from itertools import chain
from typing import Any, Generic, Optional, TypeVar

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

T = TypeVar("T")


class FluentFacet(ABC):
    @abstractmethod
    def facet(self, facet: str) -> "StringFacet":
        """Extract a single facet from a snapshot in order to do an inline snapshot."""

    @abstractmethod
    def facets(self, *facets: str) -> "StringFacet":
        """Extract multiple facets from a snapshot in order to do an inline snapshot."""

    @abstractmethod
    def facet_binary(self, facet: str) -> "BinaryFacet":
        pass


class StringFacet(FluentFacet, ABC):
    @abstractmethod
    def to_be(self, expected: str) -> str:
        pass

    @abstractmethod
    def to_be_TODO(self, _: Any = None) -> str:
        pass


class BinaryFacet(FluentFacet, ABC):
    @abstractmethod
    def to_be_base64(self, expected: str) -> bytes:
        pass

    @abstractmethod
    def to_be_base64_TODO(self, _: Any = None) -> bytes:
        pass

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
                message=f"Can't call `toMatchDisk_TODO` in {Mode.readonly} mode!"
            )

    def facet(self, facet: str) -> "StringFacet":
        return StringSelfie(self.actual, self.disk, [facet])

    def facets(self, *facets: str) -> "StringFacet":
        return StringSelfie(self.actual, self.disk, list(facets))

    def facet_binary(self, facet: str) -> "BinaryFacet":
        return BinarySelfie(self.actual, self.disk, facet)


class ReprSelfie(DiskSelfie, Generic[T]):
    def __init__(self, actual_before_repr: T, actual: Snapshot, disk: DiskStorage):
        super().__init__(actual, disk)
        self.actual_before_repr = actual_before_repr

    def to_be_TODO(self, _: Optional[T] = None) -> T:
        return _toBeDidntMatch(None, self.actual_before_repr, LiteralRepr())

    def to_be(self, expected: T) -> T:
        if self.actual_before_repr == expected:
            return _checkSrc(self.actual_before_repr)
        else:
            return _toBeDidntMatch(expected, self.actual_before_repr, LiteralRepr())


class StringSelfie(ReprSelfie[str], StringFacet):
    def __init__(
        self,
        actual: Snapshot,
        disk: DiskStorage,
        only_facets: Optional[list[str]] = None,
    ):
        super().__init__("<IT IS AN ERROR FOR THIS TO BE VISIBLE>", actual, disk)
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
                self.actual, self.only_facets or ["", *list(self.actual.facets.keys())]
            )

    def to_be_TODO(self, _: Any = None) -> str:
        return _toBeDidntMatch(None, self.__actual(), LiteralString())

    def to_be(self, expected: str) -> str:
        actual_string = self.__actual()
        if actual_string == expected:
            return _checkSrc(actual_string)
        else:
            return _toBeDidntMatch(
                expected,
                actual_string,
                LiteralString(),
            )


class BinarySelfie(ReprSelfie[bytes], BinaryFacet):
    def __init__(self, actual: Snapshot, disk: DiskStorage, only_facet: str):
        super().__init__(actual.subject.value_binary(), actual, disk)
        self.only_facet = only_facet

        facet_value = actual.subject_or_facet_maybe(only_facet)
        if facet_value is None:
            raise ValueError(f"The facet {only_facet} was not found in the snapshot")
        elif not facet_value.is_binary:
            raise ValueError(
                f"The facet {only_facet} is a string, not a binary snapshot"
            )

    def to_be_base64(self, expected: str) -> bytes:
        actual_bytes = self.actual.subject_or_facet(self.only_facet).value_binary()
        expected_bytes = base64.b64decode(expected)
        if actual_bytes == expected_bytes:
            return _checkSrc(actual_bytes)
        else:
            actual_b64 = base64.b64encode(actual_bytes).decode().replace("\r", "")
            _toBeDidntMatch(expected, actual_b64, LiteralString())
            return actual_bytes

    def to_be_base64_TODO(self, _: Any = None) -> bytes:
        call = recordCall(False)
        if not _selfieSystem().mode.can_write(True, call, _selfieSystem()):
            raise _selfieSystem().fs.assert_failed(
                message=f"Can't call `to_be_base64_TODO` in {Mode.readonly} mode!"
            )
        return self._actual_bytes()

    def _actual_bytes(self) -> bytes:
        return self.actual.subject_or_facet(self.only_facet).value_binary()

    def _actual_string(self) -> str:
        return base64.b64encode(self._actual_bytes()).decode().replace('\r', '')

    def to_be_file_impl(self, subpath: str, is_todo: bool) -> bytes:
        call = recordCall(False)
        actual_bytes = self.actual.subject_or_facet(self.only_facet).value_binary()
        writable = _selfieSystem().mode.can_write(is_todo, call, _selfieSystem())
        if is_todo and not writable:
            raise _selfieSystem().fs.assert_failed(
                message=f"Can't call `to_be_file_TODO` in {Mode.readonly} mode!"
            )
        if not writable:
            path = (
                _selfieSystem()
                .layout.sourcefile_for_call(call.location)
                .parent_folder()
                .resolve_file(subpath)
            )
            if not _selfieSystem().fs.file_exists(path):
                raise _selfieSystem().fs.assert_failed(
                    message=_selfieSystem().mode.msg_snapshot_not_found_no_such_file(
                        path
                    )
                )
            expected = _selfieSystem().fs.file_read_binary(path)
            if expected == actual_bytes:
                return actual_bytes
            else:
                raise _selfieSystem().fs.assert_failed(
                    message=_selfieSystem().mode.msg_snapshot_mismatch(),
                    expected=expected,
                    actual=actual_bytes,
                )
        else:
            if is_todo:
                _selfieSystem().write_inline(TodoStub.to_be_file.create_literal(), call)
            _selfieSystem().write_to_be_file(
                _selfieSystem()
                .layout.sourcefile_for_call(call.location)
                .parent_folder()
                .resolve_file(subpath),
                actual_bytes,
                call,
            )
            return actual_bytes

    def to_be_file_TODO(self, subpath: str) -> bytes:
        call = recordCall(False)
        if not _selfieSystem().mode.can_write(True, call, _selfieSystem()):
            raise _selfieSystem().fs.assert_failed(
                message=f"Can't call `to_be_file_TODO` in {Mode.readonly} mode!"
            )
        return self.to_be_file_impl(subpath, True)

    def to_be_file(self, subpath: str) -> bytes:
        return self.to_be_file_impl(subpath, False)


def _checkSrc(value: T) -> T:
    _selfieSystem().mode.can_write(False, recordCall(True), _selfieSystem())
    return value


def _toBeDidntMatch(expected: Optional[T], actual: T, fmt: LiteralFormat[T]) -> T:
    call = recordCall(False)
    writable = _selfieSystem().mode.can_write(expected is None, call, _selfieSystem())
    if writable:
        _selfieSystem().write_inline(LiteralValue(expected, actual, fmt), call)
        return actual
    else:
        if expected is None:
            raise _selfieSystem().fs.assert_failed(
                message=f"Can't call `toBe_TODO` in {Mode.readonly} mode!"
            )
        else:
            raise _selfieSystem().fs.assert_failed(
                message=_selfieSystem().mode.msg_snapshot_mismatch(),
                expected=expected,
                actual=actual,
            )


def _assertEqual(
    expected: Optional[Snapshot], actual: Snapshot, storage: SnapshotSystem
):
    if expected is None:
        raise storage.fs.assert_failed(message=storage.mode.msg_snapshot_not_found())
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
                    (facet for facet in actual.facets if facet not in expected.facets),
                ),
            )
        )
        raise storage.fs.assert_failed(
            message=storage.mode.msg_snapshot_mismatch(),
            expected=_serializeOnlyFacets(expected, mismatched_keys),
            actual=_serializeOnlyFacets(actual, mismatched_keys),
        )


def _serializeOnlyFacets(snapshot: Snapshot, keys: list[str]) -> str:
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
