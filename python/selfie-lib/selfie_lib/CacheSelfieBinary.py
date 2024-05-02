from typing import Generic, TypeVar, Optional, Any
from .SnapshotSystem import DiskStorage
from .RoundTrip import Roundtrip
from .Selfie import Cacheable
from .Selfie import get_system
from .WriteTracker import recordCall
from .Literals import LiteralValue, LiteralString, TodoStub
from .Snapshot import Snapshot
import base64

T = TypeVar("T")


class CacheSelfieBinary(Generic[T]):
    def __init__(self, disk: DiskStorage, roundtrip: Roundtrip[T, bytes], generator):
        self.disk: DiskStorage = disk
        self.roundtrip: Roundtrip[T, bytes] = roundtrip
        self.generator = generator

    def to_match_disk(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, False)

    def to_match_disk_TODO(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, True)

    def _to_match_disk_impl(self, sub: str, is_todo: bool) -> T:
        system = get_system()
        call = recordCall(False)

        if system.mode.can_write(is_todo, call, system):
            actual = self.generator()
            serialized_data = self.roundtrip.serialize(actual)
            self.disk.write_disk(Snapshot.of(serialized_data), sub, call)

            if is_todo:
                system.write_inline(TodoStub.toMatchDisk.create_literal(), call)

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
                        "Expected a binary subject with no facets, got {}".format(
                            snapshot
                        )
                    )

                return self.roundtrip.parse(snapshot.subject.value_binary())

    def to_be_file_TODO(self, subpath: str) -> T:
        return self._to_be_file_impl(subpath, True)

    def to_be_file(self, subpath: str) -> T:
        return self._to_be_file_impl(subpath, False)

    def _to_be_file_impl(self, subpath: str, is_todo: bool) -> T:
        system = get_system()
        call = recordCall(False)
        writable = system.mode.can_write(is_todo, call, system)

        if writable:
            actual = self.generator()

            if is_todo:
                system.write_inline(TodoStub.toBeFile.create_literal(), call)

            with open(subpath, "wb") as file:
                file.write(self.roundtrip.serialize(actual))

            return actual
        else:
            if is_todo:
                raise Exception("Can't call `toBeFile_TODO` in read-only mode!")
            else:
                with open(subpath, "rb") as file:
                    serialized_data = file.read()
                return self.roundtrip.parse(serialized_data)

    def to_be_base64_TODO(self, unused_arg: Optional[Any] = None) -> T:
        return self._to_be_base64_impl(None)

    def to_be_base64(self, snapshot: str) -> T:
        return self._to_be_base64_impl(snapshot)

    def _to_be_base64_impl(self, snapshot: Optional[str]) -> T:
        system = get_system()
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
                raise Exception("Can't call `toBe_TODO` in read-only mode!")
            else:
                decoded_data = base64.b64decode(snapshot.encode("utf-8"))
                return self.roundtrip.parse(decoded_data)
