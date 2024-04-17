from abc import ABC, abstractmethod
from typing import Callable, Sequence, Optional
from .TypedPath import TypedPath
from .Snapshot import Snapshot
from .SnapshotFile import SnapshotFile
from .Literals import LiteralValue
from .SnapshotReader import SnapshotReader
from .SnapshotValueReader import SnapshotValueReader


class FS(ABC):
    @abstractmethod
    def file_walk[T](self, typed_path, walk: Callable[[Sequence[TypedPath]], T]) -> T:
        pass

    def file_read(self, typed_path) -> str:
        return self.file_read_binary(typed_path).decode()

    def file_write(self, typed_path, content: str):
        self.file_write_binary(typed_path, content.encode())

    @abstractmethod
    def file_read_binary(self, typed_path) -> bytes:
        pass

    @abstractmethod
    def file_write_binary(self, typed_path, content: bytes):
        pass

    @abstractmethod
    def assert_failed(self, message: str, expected=None, actual=None) -> Exception:
        pass


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
    from .WriteTracker import CallStack, SnapshotFileLayout

    def __init__(self):
        from .CommentTracker import CommentTracker
        from .WriteTracker import InlineWriteTracker

        self._comment_tracker = CommentTracker()
        self._inline_write_tracker = InlineWriteTracker()

    @property
    @abstractmethod
    def fs(self) -> FS:
        pass

    @property
    @abstractmethod
    def mode(self) -> "Mode":
        pass

    @property
    @abstractmethod
    def layout(self) -> SnapshotFileLayout:
        pass

    def source_file_has_writable_comment(self, call: CallStack) -> bool:
        return self._comment_tracker.hasWritableComment(call, self.layout)

    def write_inline(self, literal_value: LiteralValue, call: CallStack):
        from .WriteTracker import CallLocation

        call_location = CallLocation(call.location.file_name, call.location.line)
        self._inline_write_tracker.record(
            call_location, literal_value, call, self.layout
        )

    @abstractmethod
    def diskThreadLocal(self) -> DiskStorage:
        pass

    def read_snapshot_from_disk(self, file_path: TypedPath) -> Optional[Snapshot]:
        try:
            content = self.fs.file_read_binary(file_path)
            value_reader = SnapshotValueReader.of_binary(content)
            snapshot_reader = SnapshotReader(value_reader)
            return snapshot_reader.next_snapshot()
        except Exception as e:
            raise self.fs.assert_failed(
                f"Failed to read snapshot from {file_path.absolute_path}: {str(e)}"
            )

    def write_snapshot_to_disk(self, snapshot: Snapshot, file_path: TypedPath):
        try:
            # Create a SnapshotFile object that will contain the snapshot
            snapshot_file = SnapshotFile.create_empty_with_unix_newlines(True)
            snapshot_file.set_at_test_time("default", snapshot)

            # Serialize the SnapshotFile object
            serialized_data = []
            snapshot_file.serialize(serialized_data)

            # Write serialized data to disk as binary
            serialized_str = "\n".join(serialized_data)
            self.fs.file_write_binary(file_path, serialized_str.encode())
        except Exception as e:
            raise self.fs.assert_failed(
                f"Failed to write snapshot to {file_path.absolute_path}: {str(e)}"
            )


selfieSystem = None


def _initSelfieSystem(system: SnapshotSystem):
    global selfieSystem
    # TODO: Figure out how to wipe this state in unit tests
    # if selfieSystem is not None:
    #     raise Exception("Selfie system already initialized")
    selfieSystem = system


def _selfieSystem() -> "SnapshotSystem":
    if selfieSystem is None:
        raise Exception(
            "Selfie system not initialized, make sure that `pytest-selfie` is installed and that you are running tests with `pytest`."
        )
    return selfieSystem
