from abc import ABC, abstractmethod
from typing import Callable, Sequence, Optional
from .TypedPath import TypedPath
from .Snapshot import Snapshot
from .SnapshotFile import SnapshotFile
from .Literals import LiteralValue


class FS(ABC):
    @abstractmethod
    def file_walk[T](self, typed_path, walk: Callable[[Sequence["TypedPath"]], T]) -> T:
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
    from .WriteTracker import CallStack

    @property
    @abstractmethod
    def fs(self) -> FS:
        pass

    @property
    @abstractmethod
    def mode(self) -> str:  # Adjust the type if Mode is an Enum or a specific class
        pass

    @property
    @abstractmethod
    def layout(self) -> SnapshotFile:
        pass

    @abstractmethod
    def source_file_has_writable_comment(self, call: CallStack) -> bool:
        pass

    @abstractmethod
    def write_inline(self, literal_value: LiteralValue, call: CallStack):
        pass

    @abstractmethod
    def diskThreadLocal(self) -> DiskStorage:
        pass


selfieSystem = None


def _initSelfieSystem(system: SnapshotSystem):
    global selfieSystem
    if selfieSystem is not None:
        raise Exception("Selfie system already initialized")
    selfieSystem = system


def _selfieSystem() -> "SnapshotSystem":
    if selfieSystem is None:
        raise Exception(
            "Selfie system not initialized, make sure that `pytest-selfie` is installed and that you are running tests with `pytest`."
        )
    return selfieSystem
