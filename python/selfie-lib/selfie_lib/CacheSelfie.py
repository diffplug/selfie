from typing import Generic, TypeVar, Optional, Any
from .WriteTracker import recordCall
from .Snapshot import Snapshot
from .Literals import LiteralValue, LiteralString, TodoStub
from .SnapshotSystem import DiskStorage
from .RoundTrip import Roundtrip

T = TypeVar("T")


class CacheSelfie(Generic[T]):
    def __init__(self, disk: DiskStorage, roundtrip: Roundtrip[T, str], generator):
        from .Selfie import Cacheable

        self.disk: DiskStorage = disk
        self.roundtrip: Roundtrip[T, str] = roundtrip
        self.generator: Cacheable[T] = generator

    def to_match_disk(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, False)

    def to_match_disk_TODO(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, True)

    def _to_match_disk_impl(self, sub: str, is_todo: bool) -> T:
        from .Selfie import _selfieSystem

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

    def to_be_TODO(self, unused_arg: Optional[Any] = None) -> T:
        return self._to_be_impl(None)

    def to_be(self, expected: str) -> T:
        return self._to_be_impl(expected)

    def _to_be_impl(self, snapshot: Optional[str]) -> T:
        from .Selfie import _selfieSystem

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
