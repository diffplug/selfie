import inspect
import os
import threading
from abc import ABC, abstractmethod
from functools import total_ordering
from pathlib import Path
from typing import Generic, Optional, TypeVar, cast

from .FS import FS
from .Literals import LiteralString, LiteralTodoStub, LiteralValue, TodoStub
from .SourceFile import SourceFile
from .TypedPath import TypedPath

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

    def ide_link(self, _: "SnapshotFileLayout") -> str:
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
    def __init__(self, location: CallLocation, rest_of_stack: list[CallLocation]):
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


class SnapshotFileLayout(ABC):
    def __init__(self, fs: FS):
        self.fs = fs

    @abstractmethod
    def root_folder(self) -> TypedPath:
        pass

    def sourcefile_for_call(self, call: CallLocation) -> TypedPath:
        file_path = call.file_name
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
        self.writes: dict[T, FirstWrite[U]] = {}

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
                    f"Snapshot was set to multiple values!\n  first time: {existing.call_stack.location.ide_link(layout)}\n   this time: {call.location.ide_link(layout)}"
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

        file = layout.sourcefile_for_call(call.location)

        if (
            snapshot.expected is not None
            and isinstance(snapshot.expected, str)
            and isinstance(snapshot.format, LiteralString)
        ):
            content = SourceFile(file.name, layout.fs.file_read(file))
            try:
                snapshot = cast(LiteralValue, snapshot)
                parsed_value = content.parse_to_be_like(
                    call.location.line
                ).parse_literal(snapshot.format)
            except Exception as e:
                raise AssertionError(
                    f"Error while parsing the literal at {call.location.ide_link(layout)}. Please report this error at https://github.com/diffplug/selfie"
                ) from e
            if parsed_value != snapshot.expected:
                raise layout.fs.assert_failed(
                    f"Selfie cannot modify the literal at {call.location.ide_link(layout)} because Selfie has a parsing bug. Please report this error at https://github.com/diffplug/selfie",
                    snapshot.expected,
                    parsed_value,
                )

    def persist_writes(self, layout: SnapshotFileLayout):
        # Assuming there is at least one write to process
        if not self.writes:
            return

        # Sorting writes based on file name and line number
        sorted_writes = sorted(
            self.writes.values(),
            key=lambda x: (x.call_stack.location.file_name, x.call_stack.location.line),
        )

        # Initialize from the first write
        first_write = sorted_writes[0]
        current_file = layout.sourcefile_for_call(first_write.call_stack.location)
        content = SourceFile(current_file.name, layout.fs.file_read(current_file))
        delta_line_numbers = 0

        for write in sorted_writes:
            # Determine the file path for the current write
            file_path = layout.sourcefile_for_call(write.call_stack.location)
            # If we switch to a new file, write changes to the disk for the previous file
            if file_path != current_file:
                layout.fs.file_write(current_file, content.as_string)
                current_file = file_path
                content = SourceFile(
                    current_file.name, layout.fs.file_read(current_file)
                )
                delta_line_numbers = 0

            # Calculate the line number taking into account changes that shifted line numbers
            line = write.call_stack.location.line + delta_line_numbers
            if isinstance(write.snapshot.format, LiteralTodoStub):
                kind: TodoStub = write.snapshot.actual  # type: ignore
                content.replace_on_line(line, f".{kind.name}_TODO(", f".{kind.name}(")
            else:
                to_be_literal = content.parse_to_be_like(line)
                # Attempt to set the literal value and adjust for line shifts due to content changes
                literal_change = to_be_literal.set_literal_and_get_newline_delta(
                    write.snapshot
                )
                delta_line_numbers += literal_change

        # Final write to disk for the last file processed
        layout.fs.file_write(current_file, content.as_string)


class ToBeFileLazyBytes:
    def __init__(self, location: TypedPath, layout: SnapshotFileLayout, data: bytes):
        self.location = location
        self.layout = layout
        self.data = data

    def writeToDisk(self) -> None:
        if self.data is None:
            raise Exception("Data has already been written to disk")
        self.layout.fs.file_write_binary(self.location, self.data)
        self.data = None  # Allow garbage collection

    def readData(self):
        if self.data is not None:
            return self.data
        return self.layout.fs.file_read_binary(self.location)

    def __eq__(self, other):
        if not isinstance(other, ToBeFileLazyBytes):
            return False
        return self.readData() == other.readData()

    def __hash__(self):
        return hash(self.readData())


class ToBeFileWriteTracker(WriteTracker[TypedPath, ToBeFileLazyBytes]):
    def __init__(self):
        super().__init__()

    def writeToDisk(
        self,
        key: TypedPath,
        snapshot: bytes,
        call: CallStack,
        layout: SnapshotFileLayout,
    ) -> None:
        lazyBytes = ToBeFileLazyBytes(key, layout, snapshot)
        self.recordInternal(key, lazyBytes, call, layout)
        lazyBytes.writeToDisk()
