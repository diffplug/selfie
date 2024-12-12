from abc import ABC, abstractmethod
from collections.abc import Iterator
from pathlib import Path
from typing import Callable, TypeVar

from selfie_lib.TypedPath import TypedPath

T = TypeVar("T")


class FS(ABC):
    def file_exists(self, typed_path: TypedPath) -> bool:
        return Path(typed_path.absolute_path).is_file()

    def file_walk(
        self, typed_path: TypedPath, walk: Callable[[Iterator[TypedPath]], T]
    ) -> T:
        def walk_generator(path: TypedPath) -> Iterator[TypedPath]:
            for file_path in Path(path.absolute_path).rglob("*"):
                if file_path.is_file():
                    yield TypedPath(file_path.absolute().as_posix())

        return walk(walk_generator(typed_path))

    def file_read(self, typed_path) -> str:
        return self.file_read_binary(typed_path).decode()

    def file_write(self, typed_path, content: str):
        self.file_write_binary(typed_path, content.encode())

    def file_read_binary(self, typed_path: TypedPath) -> bytes:
        return Path(typed_path.absolute_path).read_bytes()

    def file_write_binary(self, typed_path: TypedPath, content: bytes):
        Path(typed_path.absolute_path).write_bytes(content)

    @abstractmethod
    def assert_failed(self, message, expected=None, actual=None) -> Exception:
        pass
