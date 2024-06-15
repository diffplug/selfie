import re
from abc import ABC, abstractmethod
from typing import Callable, Generic, Iterator, List, Optional, Protocol, TypeVar

from .Snapshot import Snapshot, SnapshotValue

T = TypeVar("T")


class Lens(Protocol[Snapshot]):
    def __call__(self, snapshot: Snapshot) -> Snapshot:
        raise NotImplementedError


class CompoundLens(Lens):
    def __init__(self):
        self.lenses: List[Lens] = []

    def __call__(self, snapshot: Snapshot) -> Snapshot:
        current = snapshot
        for lens in self.lenses:
            current = lens(current)
        return current

    def add(self, lens: Lens) -> "CompoundLens":
        self.lenses.append(lens)
        return self

    def mutate_all_facets(
        self, perString: Callable[[str], Optional[str]]
    ) -> "CompoundLens":
        def _mutate_each(snapshot: Snapshot) -> Iterator[tuple[str, SnapshotValue]]:
            for entry in snapshot.items():
                if entry[1].is_binary:
                    yield entry
                else:
                    mapped = perString(entry[1].value_string())
                    if mapped is not None:
                        yield (entry[0], SnapshotValue.of(mapped))

        return self.add(lambda snapshot: Snapshot.of_items(_mutate_each(snapshot)))

    def replace_all(self, toReplace: str, replacement: str) -> "CompoundLens":
        return self.mutate_all_facets(lambda s: s.replace(toReplace, replacement))

    def replace_all_regex(
        self, pattern: str | re.Pattern[str], replacement: str
    ) -> "CompoundLens":
        return self.mutate_all_facets(lambda s: re.sub(pattern, replacement, s))

    def set_facet_from(
        self, target: str, source: str, function: Callable[[str], Optional[str]]
    ) -> "CompoundLens":
        def _set_facet_from(snapshot: Snapshot) -> Snapshot:
            source_value = snapshot.subject_or_facet_maybe(source)
            if source_value is None:
                return snapshot
            else:
                return self.__set_facet_of(
                    snapshot, target, function(source_value.value_string())
                )

        return self.add(_set_facet_from)

    def __set_facet_of(
        self, snapshot: Snapshot, target: str, new_value: Optional[str]
    ) -> Snapshot:
        if new_value is None:
            return snapshot
        else:
            return snapshot.plus_or_replace(target, SnapshotValue.of(new_value))

    def mutate_facet(
        self, target: str, function: Callable[[str], Optional[str]]
    ) -> "CompoundLens":
        return self.set_facet_from(target, target, function)


class Camera(Generic[T], ABC):
    @abstractmethod
    def snapshot(self, subject: T) -> Snapshot:
        pass

    def with_lens(self, lens: Lens) -> "Camera[T]":
        class WithLensCamera(Camera):
            def __init__(self, camera: Camera[T], lens: Callable[[Snapshot], Snapshot]):
                self.__camera = camera
                self.__lens = lens

            def snapshot(self, subject: T) -> Snapshot:
                return self.__lens(self.__camera.snapshot(subject))

        return WithLensCamera(self, lens)
