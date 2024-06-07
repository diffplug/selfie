from abc import ABC, abstractmethod
from typing import Callable, Generic, TypeVar

from .Snapshot import Snapshot

T = TypeVar("T", contravariant=True)


class Camera(Generic[T], ABC):
    @abstractmethod
    def snapshot(self, subject: T) -> Snapshot:
        pass

    def with_lens(self, lens: Callable[[Snapshot], Snapshot]) -> "Camera[T]":
        class WithLensCamera(Camera):
            def __init__(self, camera: Camera[T], lens: Callable[[Snapshot], Snapshot]):
                self.__camera = camera
                self.__lens = lens

            def snapshot(self, subject: T) -> Snapshot:
                return self.__lens(self.__camera.snapshot(subject))

        return WithLensCamera(self, lens)
