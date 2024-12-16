import base64
from typing import Any, Callable, Generic, Optional, TypeVar, Union, overload

from .Literals import LiteralString, LiteralValue, TodoStub
from .Roundtrip import Roundtrip
from .Snapshot import Snapshot
from .SnapshotSystem import DiskStorage, _selfieSystem
from .WriteTracker import recordCall

T = TypeVar("T", covariant=True)


@overload
def cache_selfie(to_cache: Callable[..., str]) -> "CacheSelfie[str]": ...


@overload
def cache_selfie(
    to_cache: Callable[..., T], roundtrip: Roundtrip[T, str]
) -> "CacheSelfie[T]": ...


def cache_selfie(
    to_cache: Union[Callable[..., str], Callable[..., T]],
    roundtrip: Optional[Roundtrip[T, str]] = None,
) -> Union["CacheSelfie[str]", "CacheSelfie[T]"]:
    if roundtrip is None:
        # the cacheable better be a string!
        return cache_selfie(to_cache, Roundtrip.identity())  # type: ignore
    elif isinstance(roundtrip, Roundtrip) and to_cache is not None:
        deferred_disk_storage = _selfieSystem().disk_thread_local()
        return CacheSelfie(deferred_disk_storage, roundtrip, to_cache)  # type: ignore
    else:
        raise TypeError("Invalid arguments provided to cache_selfie")


def cache_selfie_json(to_cache: Callable[..., T]) -> "CacheSelfie[T]":
    return cache_selfie(to_cache, Roundtrip.json())


@overload
def cache_selfie_binary(
    to_cache: Callable[..., bytes],
) -> "CacheSelfieBinary[bytes]": ...


@overload
def cache_selfie_binary(
    to_cache: Callable[..., T], roundtrip: Roundtrip[T, bytes]
) -> "CacheSelfieBinary[T]": ...


def cache_selfie_binary(
    to_cache: Union[Callable[..., bytes], Callable[..., T]],
    roundtrip: Optional[Roundtrip[T, bytes]] = None,
) -> Union["CacheSelfieBinary[bytes]", "CacheSelfieBinary[T]"]:
    if roundtrip is None:
        # the cacheable better be a bytes!
        return cache_selfie_binary(to_cache, Roundtrip.identity())  # type: ignore
    elif isinstance(roundtrip, Roundtrip) and to_cache is not None:
        deferred_disk_storage = _selfieSystem().disk_thread_local()
        return CacheSelfieBinary(deferred_disk_storage, roundtrip, to_cache)  # type: ignore
    else:
        raise TypeError("Invalid arguments provided to cache_selfie")


class CacheSelfie(Generic[T]):
    def __init__(
        self,
        disk: DiskStorage,
        roundtrip: Roundtrip[T, str],
        generator: Callable[..., T],
    ):
        self.disk = disk
        self.roundtrip = roundtrip
        self.generator = generator

    def to_match_disk(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, False)

    def to_match_disk_TODO(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, True)

    def _to_match_disk_impl(self, sub: str, is_todo: bool) -> T:
        call = recordCall(False)
        system = _selfieSystem()
        if system.mode.can_write(is_todo, call, system):
            actual = self.generator()
            self.disk.write_disk(
                Snapshot.of(self.roundtrip.serialize(actual)), sub, call
            )
            if is_todo:
                system.write_inline(TodoStub.to_match_disk.create_literal(), call)
            return actual
        else:
            if is_todo:
                raise Exception("Can't call `to_match_disk_todo` in readonly mode!")
            else:
                snapshot = self.disk.read_disk(sub, call)
                if snapshot is None:
                    raise Exception(system.mode.msg_snapshot_not_found())
                if snapshot.subject.is_binary or len(snapshot.facets) > 0:
                    raise Exception(
                        f"Expected a string subject with no facets, got {snapshot}"
                    )
                return self.roundtrip.parse(snapshot.subject.value_string())

    def to_be_TODO(self, _: Optional[Any] = None) -> T:
        return self._to_be_impl(None)

    def to_be(self, expected: str) -> T:
        return self._to_be_impl(expected)

    def _to_be_impl(self, snapshot: Optional[str]) -> T:
        call = recordCall(False)
        system = _selfieSystem()
        writable = system.mode.can_write(snapshot is None, call, system)
        if writable:
            actual = self.generator()
            literal_string_formatter = LiteralString()
            system.write_inline(
                LiteralValue(
                    snapshot, self.roundtrip.serialize(actual), literal_string_formatter
                ),
                call,
            )
            return actual
        else:
            if snapshot is None:
                raise Exception("Can't call `to_be_todo` in readonly mode!")
            else:
                return self.roundtrip.parse(snapshot)


class CacheSelfieBinary(Generic[T]):
    def __init__(
        self,
        disk: DiskStorage,
        roundtrip: Roundtrip[T, bytes],
        generator: Callable[..., T],
    ):
        self.disk = disk
        self.roundtrip = roundtrip
        self.generator = generator

    def to_match_disk(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, False)

    def to_match_disk_TODO(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, True)

    def _to_match_disk_impl(self, sub: str, is_todo: bool) -> T:
        system = _selfieSystem()
        call = recordCall(False)

        if system.mode.can_write(is_todo, call, system):
            actual = self.generator()
            serialized_data = self.roundtrip.serialize(actual)
            self.disk.write_disk(Snapshot.of(serialized_data), sub, call)

            if is_todo:
                system.write_inline(TodoStub.to_match_disk.create_literal(), call)

            return actual
        else:
            if is_todo:
                raise Exception("Can't call `to_match_disk_TODO` in read-only mode!")
            else:
                snapshot = self.disk.read_disk(sub, call)

                if snapshot is None:
                    raise Exception(system.mode.msg_snapshot_not_found())

                if snapshot.subject.is_binary or len(snapshot.facets) > 0:
                    raise Exception(
                        f"Expected a binary subject with no facets, got {snapshot}"
                    )

                return self.roundtrip.parse(snapshot.subject.value_binary())

    def to_be_file_TODO(self, subpath: str) -> T:
        return self._to_be_file_impl(subpath, True)

    def to_be_file(self, subpath: str) -> T:
        return self._to_be_file_impl(subpath, False)

    def _to_be_file_impl(self, subpath: str, is_todo: bool) -> T:
        system = _selfieSystem()
        call = recordCall(False)
        writable = system.mode.can_write(is_todo, call, system)

        if writable:
            actual = self.generator()

            if is_todo:
                system.write_inline(TodoStub.to_be_file.create_literal(), call)

            with open(subpath, "wb") as file:
                file.write(self.roundtrip.serialize(actual))

            return actual
        else:
            if is_todo:
                raise Exception("Can't call `to_be_file_TODO` in read-only mode!")
            else:
                with open(subpath, "rb") as file:
                    serialized_data = file.read()
                return self.roundtrip.parse(serialized_data)

    def to_be_base64_TODO(self, _: Optional[Any] = None) -> T:
        return self._to_be_base64_impl(None)

    def to_be_base64(self, snapshot: str) -> T:
        return self._to_be_base64_impl(snapshot)

    def _to_be_base64_impl(self, snapshot: Optional[str]) -> T:
        system = _selfieSystem()
        call = recordCall(False)
        writable = system.mode.can_write(snapshot is None, call, system)

        if writable:
            actual = self.generator()
            base64_data = base64.b64encode(self.roundtrip.serialize(actual)).decode(
                "utf-8"
            )
            literal_string_formatter = LiteralString()
            system.write_inline(
                LiteralValue(snapshot, base64_data, literal_string_formatter),
                call,
            )
            return actual
        else:
            if snapshot is None:
                raise Exception("Can't call `to_be_TODO` in read-only mode!")
            else:
                decoded_data = base64.b64decode(snapshot.encode("utf-8"))
                return self.roundtrip.parse(decoded_data)
