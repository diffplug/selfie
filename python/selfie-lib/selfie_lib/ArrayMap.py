from collections.abc import Set, Iterator, Mapping
from typing import List, TypeVar, Union, Any
from abc import abstractmethod, ABC

T = TypeVar("T")
V = TypeVar("V")
K = TypeVar("K")


def _compare_normal(a, b) -> int:
    if a == b:
        return 0
    elif a < b:
        return -1
    else:
        return 1


def _compare_string_slash_first(a: str, b: str) -> int:
    return _compare_normal(a.replace("/", "\0"), b.replace("/", "\0"))


def _binary_search(data, item) -> int:
    compare_func = (
        _compare_string_slash_first if isinstance(item, str) else _compare_normal
    )
    low, high = 0, len(data) - 1
    while low <= high:
        mid = (low + high) // 2
        mid_val = data[mid]
        comparison = compare_func(mid_val, item)

        if comparison < 0:
            low = mid + 1
        elif comparison > 0:
            high = mid - 1
        else:
            return mid  # item found
    return -(low + 1)  # item not found


class ListBackedSet(Set[T], ABC):
    @abstractmethod
    def __len__(self) -> int: ...

    @abstractmethod
    def __getitem__(self, index: Union[int, slice]) -> Union[T, List[T]]: ...

    @abstractmethod
    def __iter__(self) -> Iterator[T]: ...

    def __contains__(self, item: Any) -> bool:
        return self._binary_search(item) >= 0

    def _binary_search(self, item: Any) -> int:
        return _binary_search(self, item)


class ArraySet(ListBackedSet[K]):
    __data: List[K]

    def __init__(self):
        raise NotImplementedError("Use ArraySet.empty() or other class methods instead")

    @classmethod
    def __create(cls, data: List[K]) -> "ArraySet[K]":
        instance = super().__new__(cls)
        instance.__data = data
        return instance

    def __iter__(self) -> Iterator[K]:
        return iter(self.__data)

    @classmethod
    def empty(cls) -> "ArraySet[K]":
        if not hasattr(cls, "__EMPTY"):
            cls.__EMPTY = cls.__create([])
        return cls.__EMPTY

    def __len__(self) -> int:
        return len(self.__data)

    def __getitem__(self, index: Union[int, slice]) -> Union[K, List[K]]:
        return self.__data[index]

    def plusOrThis(self, element: K) -> "ArraySet[K]":
        index = self._binary_search(element)
        if index >= 0:
            return self
        else:
            insert_at = -(index + 1)
            new_data = self.__data[:]
            new_data.insert(insert_at, element)
            return ArraySet.__create(new_data)


class ArrayMap(Mapping[K, V]):
    __data: List[Union[K, V]]

    def __init__(self):
        raise NotImplementedError("Use ArrayMap.empty() or other class methods instead")

    @classmethod
    def __create(cls, data: List[Union[K, V]]) -> "ArrayMap[K, V]":
        instance = cls.__new__(cls)
        instance.__data = data
        return instance

    @classmethod
    def empty(cls) -> "ArrayMap[K, V]":
        if not hasattr(cls, "__EMPTY"):
            cls.__EMPTY = cls.__create([])
        return cls.__EMPTY

    def __getitem__(self, key: K) -> V:
        index = self._binary_search_key(key)
        if index >= 0:
            return self.__data[2 * index + 1]  # type: ignore
        raise KeyError(key)

    def __iter__(self) -> Iterator[K]:
        return (self.__data[i] for i in range(0, len(self.__data), 2))  # type: ignore

    def __len__(self) -> int:
        return len(self.__data) // 2

    def _binary_search_key(self, key: K) -> int:
        keys = [self.__data[i] for i in range(0, len(self.__data), 2)]
        return _binary_search(keys, key)

    def plus(self, key: K, value: V) -> "ArrayMap[K, V]":
        index = self._binary_search_key(key)
        if index >= 0:
            raise ValueError("Key already exists")
        insert_at = -(index + 1)
        new_data = self.__data[:]
        new_data.insert(insert_at * 2, key)
        new_data.insert(insert_at * 2 + 1, value)
        return ArrayMap.__create(new_data)

    def minus_sorted_indices(self, indices: List[int]) -> "ArrayMap[K, V]":
        new_data = self.__data[:]
        adjusted_indices = [i * 2 for i in indices] + [i * 2 + 1 for i in indices]
        adjusted_indices.sort(reverse=True)
        for index in adjusted_indices:
            del new_data[index]
        return ArrayMap.__create(new_data)
