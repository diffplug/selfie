from pathlib import Path
from typing import List, Optional, Generic, TypeVar, Dict, cast
from abc import ABC, abstractmethod
import inspect
import threading
import os
from functools import total_ordering

from .SourceFile import SourceFile
from .Literals import LiteralValue
from .TypedPath import TypedPath
from .FS import FS


T = TypeVar("T")
U = TypeVar("U")


@total_ordering
class CallLocation:
    def __init__(self, file_name: Optional[str], line: int):
        self._file_name = file_name
        self._line = line

    @property
    def file_name(self) -> Optional[str]:
        return self._file_name

    @property
    def line(self) -> int:
        return self._line

    def with_line(self, line: int) -> "CallLocation":
        return CallLocation(self._file_name, line)

    def ide_link(self, layout: "SnapshotFileLayout") -> str:
        return f"File: {self._file_name}, Line: {self._line}"

    def same_path_as(self, other: "CallLocation") -> bool:
        if not isinstance(other, CallLocation):
            return False
        return self._file_name == other.file_name

    def source_filename_without_extension(self) -> str:
        if self._file_name is not None:
            return self._file_name.rsplit(".", 1)[0]
        return ""

    def __lt__(self, other) -> bool:
        if not isinstance(other, CallLocation):
            return NotImplemented
        return (self._file_name, self._line) < (other.file_name, other.line)

    def __eq__(self, other) -> bool:
        if not isinstance(other, CallLocation):
            return NotImplemented
        return (self._file_name, self._line) == (other.file_name, other.line)

    def __hash__(self):
        return hash((self._file_name, self._line))


class CallStack:
    def __init__(self, location: CallLocation, rest_of_stack: List[CallLocation]):
        self.location = location
        self.rest_of_stack = rest_of_stack

    def ide_link(self, layout: "SnapshotFileLayout") -> str:
        links = [self.location.ide_link(layout)] + [
            loc.ide_link(layout) for loc in self.rest_of_stack
        ]
        return "\n".join(links)

    def __eq__(self, other):
        if not isinstance(other, CallStack):
            return NotImplemented
        return (
            self.location == other.location
            and self.rest_of_stack == other.rest_of_stack
        )

    def __hash__(self):
        return hash((self.location, tuple(self.rest_of_stack)))


class SnapshotFileLayout:
    def __init__(self, fs: FS):
        self.fs = fs

    def sourcefile_for_call(self, call: CallStack) -> TypedPath:
        file_path = call.location.file_name
        if not file_path:
            raise ValueError("No file path available in CallLocation.")
        return TypedPath(os.path.abspath(Path(file_path)))


def recordCall(callerFileOnly: bool) -> CallStack:
    stack_frames_raw = inspect.stack()
    first_real_frame = next(
        (
            i
            for i, x in enumerate(stack_frames_raw)
            if x.frame.f_globals.get("__package__") != __package__
        ),
        None,
    )
    # filter to only the stack after the selfie-lib package
    stack_frames = stack_frames_raw[first_real_frame:]

    if callerFileOnly:
        caller_file = stack_frames[0].filename
        stack_frames = [
            frame for frame in stack_frames if frame.filename == caller_file
        ]

    call_locations = [
        CallLocation(frame.filename, frame.lineno) for frame in stack_frames
    ]

    location = call_locations[0]
    rest_of_stack = call_locations[1:]

    return CallStack(location, rest_of_stack)


class FirstWrite(Generic[U]):
    def __init__(self, snapshot: U, call_stack: CallStack):
        self.snapshot = snapshot
        self.call_stack = call_stack


class WriteTracker(ABC, Generic[T, U]):
    def __init__(self):
        self.lock = threading.Lock()
        self.writes: Dict[T, FirstWrite[U]] = {}

    def recordInternal(
        self,
        key: T,
        snapshot: U,
        call: CallStack,
        layout: SnapshotFileLayout,
        allow_multiple_equivalent_writes: bool = True,
    ):
        with self.lock:
            this_write = FirstWrite(snapshot, call)
            if key not in self.writes:
                self.writes[key] = this_write
                return

            existing = self.writes[key]
            if existing.snapshot != snapshot:
                raise ValueError(
                    f"Snapshot was set to multiple values!\n  first time: {existing.call_stack.location.ide_link(layout)}\n   this time: {call.location.ide_link(layout)}\n"
                )
            elif not allow_multiple_equivalent_writes:
                raise ValueError("Snapshot was set to the same value multiple times.")


class DiskWriteTracker(WriteTracker[T, U]):
    def record(self, key: T, snapshot: U, call: CallStack, layout: SnapshotFileLayout):
        super().recordInternal(key, snapshot, call, layout)


class InlineWriteTracker(WriteTracker[CallLocation, LiteralValue]):
    def hasWrites(self) -> bool:
        return len(self.writes) > 0

    def record(
        self,
        snapshot: LiteralValue,
        call: CallStack,
        layout: SnapshotFileLayout,
    ):
        super().recordInternal(call.location, snapshot, call, layout)

        call_stack_from_location = CallStack(call.location, [])
        file = layout.sourcefile_for_call(call_stack_from_location)

        if snapshot.expected is not None:
            content = SourceFile(file.name, layout.fs.file_read(file))
            try:
                snapshot = cast(LiteralValue, snapshot)
                parsed_value = content.parse_to_be_like(
                    call.location.line
                ).parse_literal(snapshot.format)
            except Exception as e:
                raise AssertionError(
                    f"Error while parsing the literal at {call.location.ide_link(layout)}. Please report this error at https://github.com/diffplug/selfie",
                    e,
                )
            if parsed_value != snapshot.expected:
                raise layout.fs.assert_failed(
                    f"Selfie cannot modify the literal at {call.location.ide_link(layout)} because Selfie has a parsing bug. Please report this error at https://github.com/diffplug/selfie",
                    snapshot.expected,
                    parsed_value,
                )

    def persist_writes(self, layout: SnapshotFileLayout):
        raise NotImplementedError("InlineWriteTracker does not support persist_writes")
