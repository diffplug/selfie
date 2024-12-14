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
            _assert_equal(self.disk.read_disk(sub, call), self.actual, _selfieSystem())
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
        return _to_be_didnt_match(None, self.actual_before_repr, LiteralRepr())

    def to_be(self, expected: T) -> T:
        if self.actual_before_repr == expected:
            return _check_src(self.actual_before_repr)
        else:
            return _to_be_didnt_match(expected, self.actual_before_repr, LiteralRepr())


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
            return _serialize_only_facets(
                self.actual, self.only_facets or ["", *list(self.actual.facets.keys())]
            )

    def to_be_TODO(self, _: Any = None) -> str:
        return _to_be_didnt_match(None, self.__actual(), LiteralString())

    def to_be(self, expected: str) -> str:
        actual_string = self.__actual()
        if actual_string == expected:
            return _check_src(actual_string)
        else:
            return _to_be_didnt_match(
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

    def _actual_bytes(self) -> bytes:
        return self.actual.subject_or_facet(self.only_facet).value_binary()

    def to_match_disk(self, sub: str = "") -> "BinarySelfie":
        super().to_match_disk(sub)
        return self

    def to_match_disk_TODO(self, sub: str = "") -> "BinarySelfie":
        super().to_match_disk_TODO(sub)
        return self

    def to_be_base64_TODO(self, _: Any = None) -> bytes:
        _to_be_didnt_match(None, self._actual_string(), LiteralString())
        return self._actual_bytes()

    def to_be_base64(self, expected: str) -> bytes:
        expected_bytes = base64.b64decode(expected)
        actual_bytes = self._actual_bytes()
        if actual_bytes == expected_bytes:
            return _check_src(actual_bytes)
        else:
            _to_be_didnt_match(expected, self._actual_string(), LiteralString())
            return actual_bytes

    def _actual_string(self) -> str:
        return base64.b64encode(self._actual_bytes()).decode().replace("\r", "")

    def _to_be_file_impl(self, subpath: str, is_todo: bool) -> bytes:
        call = recordCall(False)
        writable = _selfieSystem().mode.can_write(is_todo, call, _selfieSystem())
        actual_bytes = self._actual_bytes()
        path = _selfieSystem().layout.root_folder().resolve_file(subpath)

        if writable:
            if is_todo:
                _selfieSystem().write_inline(TodoStub.to_be_file.create_literal(), call)
            _selfieSystem().write_to_be_file(path, actual_bytes, call)
            return actual_bytes
        else:
            if is_todo:
                raise _selfieSystem().fs.assert_failed(
                    f"Can't call `to_be_file_TODO` in {Mode.readonly} mode!"
                )
            else:
                if not _selfieSystem().fs.file_exists(path):
                    raise _selfieSystem().fs.assert_failed(
                        _selfieSystem().mode.msg_snapshot_not_found_no_such_file(path)
                    )
                expected = _selfieSystem().fs.file_read_binary(path)
                if expected == actual_bytes:
                    return actual_bytes
                else:
                    raise _selfieSystem().fs.assert_failed(
                        message=_selfieSystem().mode.msg_snapshot_mismatch_binary(
                            expected, actual_bytes
                        ),
                        expected=expected,
                        actual=actual_bytes,
                    )

    def to_be_file_TODO(self, subpath: str) -> bytes:
        return self._to_be_file_impl(subpath, True)

    def to_be_file(self, subpath: str) -> bytes:
        return self._to_be_file_impl(subpath, False)


def _check_src(value: T) -> T:
    _selfieSystem().mode.can_write(False, recordCall(True), _selfieSystem())
    return value


def _to_be_didnt_match(expected: Optional[T], actual: T, fmt: LiteralFormat[T]) -> T:
    call = recordCall(False)
    writable = _selfieSystem().mode.can_write(expected is None, call, _selfieSystem())
    if writable:
        _selfieSystem().write_inline(LiteralValue(expected, actual, fmt), call)
        return actual
    else:
        if expected is None:
            raise _selfieSystem().fs.assert_failed(
                f"Can't call `to_be_TODO` in {Mode.readonly} mode!"
            )
        else:
            expectedStr = repr(expected)
            actualStr = repr(actual)
            if expectedStr == actualStr:
                raise ValueError(
                    f"Value of type {type(actual)} is not `==` to the expected value, but they both have the same `repr` value:\n${expectedStr}"
                )
            else:
                raise _selfieSystem().fs.assert_failed(
                    message=_selfieSystem().mode.msg_snapshot_mismatch(
                        expected=expectedStr, actual=actualStr
                    ),
                    expected=expected,
                    actual=actual,
                )


def _assert_equal(
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
        expectedFacets = _serialize_only_facets(expected, mismatched_keys)
        actualFacets = _serialize_only_facets(actual, mismatched_keys)
        raise storage.fs.assert_failed(
            message=storage.mode.msg_snapshot_mismatch(
                expected=expectedFacets, actual=actualFacets
            ),
            expected=expectedFacets,
            actual=actualFacets,
        )


def _serialize_only_facets(snapshot: Snapshot, keys: list[str]) -> str:
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
