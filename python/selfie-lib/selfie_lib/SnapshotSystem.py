from abc import ABC, abstractmethod
from typing import Callable, Sequence
from .TypedPath import TypedPath


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


# TODO: port DiskStorage into Python, it will be all @abstractmethod just like FS
class DiskStorage:
    def __init__(self):
        pass


# TODO: port SnapshotSystem into Python, it will be all @abstractmethod just like FS
class SnapshotSystem:
    def __init__(self):
        pass

    def diskThreadLocal(self) -> "DiskStorage":
        return DiskStorage()


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
