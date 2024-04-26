from typing import Generic, TypeVar, Optional, Any
import threading
from .WriteTracker import recordCall
from .Snapshot import Snapshot
from .Literals import LiteralValue, LiteralString, TodoStub

T = TypeVar("T")


class CacheSelfie(Generic[T]):
    def __init__(self, disk, roundtrip, generator):
        self.disk = disk
        self.roundtrip = roundtrip
        self.generator = generator

    def to_match_disk(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, False)

    def to_match_disk_todo(self, sub: str = "") -> T:
        return self._to_match_disk_impl(sub, True)

    def _to_match_disk_impl(self, sub: str, is_todo: bool) -> T:
        from .Selfie import get_system

        call = recordCall(False)
        system = get_system()
        if system.mode.can_write(is_todo, call, system):
            actual = self.generator.get()
            self.disk.write_disk(
                Snapshot.of(self.roundtrip.serialize(actual)), sub, call
            )
            if is_todo:
                system.write_inline(TodoStub.toMatchDisk.create_literal(), call)
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

    def to_be_todo(self, unused_arg: Optional[Any] = None) -> T:
        return self._to_be_impl(None)

    def to_be(self, expected: str) -> T:
        return self._to_be_impl(expected)

    def _to_be_impl(self, snapshot: Optional[str]) -> T:
        from .Selfie import get_system

        call = recordCall(False)
        system = get_system()
        writable = system.mode.can_write(snapshot is None, call, system)
        if writable:
            actual = self.generator.get()
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
