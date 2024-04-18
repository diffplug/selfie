from selfie_lib.TypedPath import TypedPath


from abc import ABC, abstractmethod
from typing import Callable, Sequence


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
