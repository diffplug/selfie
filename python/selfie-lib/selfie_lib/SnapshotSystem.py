from abc import ABC, abstractmethod
from collections.abc import ByteString
from enum import Enum, auto
from typing import Optional

from .CommentTracker import CommentTracker
from .FS import FS
from .Literals import LiteralValue
from .Snapshot import Snapshot
from .TypedPath import TypedPath
from .WriteTracker import CallStack, SnapshotFileLayout


class DiskStorage(ABC):
    from .WriteTracker import CallStack

    @abstractmethod
    def read_disk(self, sub: str, call: CallStack) -> Optional[Snapshot]:
        pass

    @abstractmethod
    def write_disk(self, actual: Snapshot, sub: str, call: CallStack):
        pass

    @abstractmethod
    def keep(self, sub_or_keep_all: Optional[str]):
        pass


class SnapshotSystem(ABC):
    @property
    @abstractmethod
    def fs(self) -> FS: ...

    @property
    @abstractmethod
    def mode(self) -> "Mode": ...

    @property
    @abstractmethod
    def layout(self) -> SnapshotFileLayout: ...

    @abstractmethod
    def source_file_has_writable_comment(self, call: CallStack) -> bool:
        """
        Returns true if the sourcecode for the given call has a writable annotation.
        """
        ...

    @abstractmethod
    def write_inline(self, literal_value: LiteralValue, call: CallStack) -> None:
        """
        Indicates that the following value should be written into test sourcecode.
        """
        ...

    @abstractmethod
    def write_to_be_file(
        self, path: TypedPath, data: ByteString, call: CallStack
    ) -> None:
        """
        Writes the given bytes to the given file, checking for duplicate writes.
        """
        ...

    @abstractmethod
    def disk_thread_local(self) -> DiskStorage:
        """
        Returns the DiskStorage for the test associated with this thread, else error.
        """
        ...


selfieSystem = None


def _selfieSystem() -> "SnapshotSystem":
    if selfieSystem is None:
        raise Exception(
            "Selfie system not initialized, make sure that `pytest-selfie` is installed and that you are running tests with `pytest`."
        )
    return selfieSystem


def _initSelfieSystem(system: SnapshotSystem):
    global selfieSystem
    if selfieSystem is not None:
        raise Exception("Selfie system already initialized")
    selfieSystem = system


def _clearSelfieSystem(system: SnapshotSystem):
    global selfieSystem
    if selfieSystem is not system:
        raise Exception("This was not the running system!")
    selfieSystem = None


class Mode(Enum):
    interactive = auto()
    readonly = auto()
    overwrite = auto()

    def can_write(self, is_todo: bool, call: CallStack, system: SnapshotSystem) -> bool:
        if self == Mode.interactive:
            return is_todo or system.source_file_has_writable_comment(call)
        elif self == Mode.readonly:
            if system.source_file_has_writable_comment(call):
                layout = system.layout
                path = layout.sourcefile_for_call(call.location)
                comment, line = CommentTracker.commentString(path)
                raise system.fs.assert_failed(
                    f"Selfie is in readonly mode, so `{comment}` is illegal at {call.location.with_line(line).ide_link(layout)}"
                )
            return False
        elif self == Mode.overwrite:
            return True
        else:
            raise ValueError(f"Unknown mode: {self}")

    def msg_snapshot_not_found(self) -> str:
        return self.msg("Snapshot not found")

    def msg_snapshot_not_found_no_such_file(self, file) -> str:
        return self.msg(f"Snapshot not found: no such file {file}")

    def msg_snapshot_mismatch(self, expected: str, actual: str) -> str:  # noqa: ARG002
        return self.msg(
            "Snapshot mismatch (error msg could be better https://github.com/diffplug/selfie/issues/501)"
        )

    def msg_snapshot_mismatch_binary(self, expected: bytes, actual: bytes) -> str:
        return self.msg_snapshot_mismatch(
            self._to_quoted_printable(expected), self._to_quoted_printable(actual)
        )

    def _to_quoted_printable(self, byte_data: bytes) -> str:
        result = []
        for b in byte_data:
            # b is already an integer in [0..255] when iterating through a bytes object
            if 33 <= b <= 126 and b != 61:  # '=' is ASCII 61, so skip it
                result.append(chr(b))
            else:
                # Convert to uppercase hex, pad to 2 digits, and prepend '='
                result.append(f"={b:02X}")
        return "".join(result)

    def msg(self, headline: str) -> str:
        if self == Mode.interactive:
            return (
                f"{headline}\n"
                "- update this snapshot by adding `_TODO` to the function name\n"
                "- update all snapshots in this file by adding `#selfieonce` or `#SELFIEWRITE`"
            )
        elif self == Mode.readonly:
            return headline
        elif self == Mode.overwrite:
            return f"{headline}\n(didn't expect this to ever happen in overwrite mode)"
        else:
            raise ValueError(f"Unknown mode: {self}")
