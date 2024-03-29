from abc import ABC, abstractmethod
from collections.abc import Set, Iterator, Mapping
from typing import List, TypeVar, Union, Any, Tuple
import bisect


class Comparable:
    def __lt__(self, other: Any) -> bool:
        return NotImplemented

    def __le__(self, other: Any) -> bool:
        return NotImplemented

    def __gt__(self, other: Any) -> bool:
        return NotImplemented

    def __ge__(self, other: Any) -> bool:
        return NotImplemented


T = TypeVar("T")
V = TypeVar("V")
K = TypeVar("K", bound=Comparable)


def string_slash_first_comparator(a: Any, b: Any) -> int:
    """Special comparator for strings where '/' is considered the lowest."""
    if isinstance(a, str) and isinstance(b, str):
        return (a.replace("/", "\0"), a) < (b.replace("/", "\0"), b)
    return (a < b) - (a > b)


class ListBackedSet(Set[T], ABC):
    @abstractmethod
    def __len__(self) -> int: ...

    @abstractmethod
    def __getitem__(self, index: Union[int, slice]) -> Union[T, List[T]]: ...

    def __contains__(self, item: object) -> bool:
        try:
            index = self.__binary_search(item)
        except ValueError:
            return False
        return index >= 0

    @abstractmethod
    def __binary_search(self, item: Any) -> int: ...


class ArraySet(ListBackedSet[K]):
    __data: List[K]

    def __init__(self):
        raise NotImplementedError("Use ArraySet.empty() or other class methods instead")

    @classmethod
    def __create(cls, data: List[K]) -> "ArraySet[K]":
        instance = super().__new__(cls)
        instance.__data = data
        return instance

    @classmethod
    def empty(cls) -> "ArraySet[K]":
        if not hasattr(cls, "__EMPTY"):
            cls.__EMPTY = cls.__create([])
        return cls.__EMPTY

    def __len__(self) -> int:
        return len(self.__data)

    def __getitem__(self, index: Union[int, slice]) -> Union[K, List[K]]:
        return self.__data[index]

    def __binary_search(self, item: K) -> int:
        if isinstance(item, str):
            key = lambda x: x.replace("/", "\0")
            return (
                bisect.bisect_left(self.__data, item, key=key) - 1
                if item in self.__data
                else -1
            )
        return bisect.bisect_left(self.__data, item) - 1 if item in self.__data else -1

    def plusOrThis(self, element: K) -> "ArraySet[K]":
        index = self.__binary_search(element)
        if index >= 0:
            return self
        new_data = self.__data[:]
        bisect.insort_left(new_data, element)
        return ArraySet.__create(new_data)


class ArrayMap(Mapping[K, V]):
    __data: List[Tuple[K, V]]

    def __init__(self):
        raise NotImplementedError("Use ArrayMap.empty() or other class methods instead")

    @classmethod
    def __create(cls, data: List[Tuple[K, V]]) -> "ArrayMap[K, V]":
        instance = super().__new__(cls)
        instance.__data = data
        return instance

    @classmethod
    def empty(cls) -> "ArrayMap[K, V]":
        if not hasattr(cls, "__EMPTY"):
            cls.__EMPTY = cls.__create([])
        return cls.__EMPTY

    def __getitem__(self, key: K) -> V:
        index = self.__binary_search_key(key)
        if index >= 0:
            return self.__data[index][1]
        raise KeyError(key)

    def __iter__(self) -> Iterator[K]:
        return (key for key, _ in self.__data)

    def __len__(self) -> int:
        return len(self.__data)

    def __binary_search_key(self, key: K) -> int:
        keys = [k for k, _ in self.__data]
        index = bisect.bisect_left(keys, key)
        if index < len(keys) and keys[index] == key:
            return index
        return -1

    def plus(self, key: K, value: V) -> "ArrayMap[K, V]":
        index = self.__binary_search_key(key)
        if index >= 0:
            raise ValueError("Key already exists")
        new_data = self.__data[:]
        bisect.insort_left(new_data, (key, value))
        return ArrayMap.__create(new_data)

    def minus_sorted_indices(self, indicesToRemove: List[int]) -> "ArrayMap[K, V]":
        if not indicesToRemove:
            return self
        new_data = [
            item for i, item in enumerate(self.__data) if i not in indicesToRemove
        ]
        return ArrayMap.__create(new_data)
