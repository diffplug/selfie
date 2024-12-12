from abc import ABC, abstractmethod
from collections.abc import ItemsView, Iterator, Mapping, Set
from typing import Any, TypeVar, Union

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
    def __getitem__(self, index: Union[int, slice]) -> Union[T, list[T]]: ...

    @abstractmethod
    def __iter__(self) -> Iterator[T]: ...

    def __contains__(self, item: Any) -> bool:
        return self._binary_search(item) >= 0

    def _binary_search(self, item: Any) -> int:
        return _binary_search(self, item)


class ArraySet(ListBackedSet[K]):
    __data: list[K]

    def __init__(self):
        raise NotImplementedError("Use ArraySet.empty() or other class methods instead")

    @classmethod
    def __create(cls, data: list[K]) -> "ArraySet[K]":
        instance = super().__new__(cls)
        instance.__data = data  # noqa: SLF001
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

    def __getitem__(self, index: Union[int, slice]) -> Union[K, list[K]]:
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


class _ArrayMapKeys(ListBackedSet[K]):
    def __init__(self, data: list[Union[K, V]]):
        self.__data = data

    def __len__(self) -> int:
        return len(self.__data) // 2

    def __getitem__(self, index: Union[int, slice]):  # type: ignore
        if isinstance(index, slice):
            return [
                self.__data[i]
                for i in range(
                    index.start * 2 if index.start else 0,
                    index.stop * 2 if index.stop else len(self.__data),
                    index.step * 2 if index.step else 2,
                )
            ]
        else:
            return self.__data[2 * index]

    def __iter__(self) -> Iterator[K]:
        return (self.__data[i] for i in range(0, len(self.__data), 2))  # type: ignore


class _ArrayMapEntries(ListBackedSet[tuple[K, V]], ItemsView[K, V]):
    def __init__(self, data: list[Union[K, V]]):
        self.__data = data

    def __len__(self) -> int:
        return len(self.__data) // 2

    def __getitem__(self, index: Union[int, slice]):  # type: ignore
        if isinstance(index, slice):
            return [
                (self.__data[i], self.__data[i + 1])
                for i in range(
                    index.start * 2 if index.start else 0,
                    index.stop * 2 if index.stop else len(self.__data),
                    index.step * 2 if index.step else 2,
                )
            ]
        else:
            return (self.__data[2 * index], self.__data[2 * index + 1])

    def __iter__(self) -> Iterator[tuple[K, V]]:
        return (
            (self.__data[i], self.__data[i + 1]) for i in range(0, len(self.__data), 2)
        )  # type: ignore


class ArrayMap(Mapping[K, V]):
    __data: list[Union[K, V]]
    __keys: ListBackedSet[K]

    def __init__(self):
        raise NotImplementedError("Use ArrayMap.empty() or other class methods instead")

    @classmethod
    def __create(cls, data: list[Union[K, V]]) -> "ArrayMap[K, V]":
        instance = cls.__new__(cls)
        instance.__data = data  # noqa: SLF001
        instance.__keys = _ArrayMapKeys(data)  # noqa: SLF001
        return instance

    @classmethod
    def empty(cls) -> "ArrayMap[K, V]":
        if not hasattr(cls, "__EMPTY"):
            cls.__EMPTY = cls.__create([])
        return cls.__EMPTY

    def keys(self) -> ListBackedSet[K]:  # type: ignore
        return self.__keys

    def items(self) -> _ArrayMapEntries[K, V]:  # type: ignore
        return _ArrayMapEntries(self.__data)

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
        return _binary_search(self.__keys, key)

    def plus(self, key: K, value: V) -> "ArrayMap[K, V]":
        index = self._binary_search_key(key)
        if index >= 0:
            raise KeyError
        insert_at = -(index + 1)
        new_data = self.__data[:]
        new_data.insert(insert_at * 2, key)
        new_data.insert(insert_at * 2 + 1, value)
        return ArrayMap.__create(new_data)

    def minus_sorted_indices(self, indices: list[int]) -> "ArrayMap[K, V]":
        new_data = self.__data[:]
        adjusted_indices = [i * 2 for i in indices] + [i * 2 + 1 for i in indices]
        adjusted_indices.sort(reverse=True)
        for index in adjusted_indices:
            del new_data[index]
        return ArrayMap.__create(new_data)

    def plus_or_noop(self, key: K, value: V) -> "ArrayMap[K, V]":
        index = self._binary_search_key(key)
        if index >= 0:
            return self
        else:
            # Insert new key-value pair
            insert_at = -(index + 1)
            new_data = self.__data[:]
            new_data.insert(insert_at * 2, key)
            new_data.insert(insert_at * 2 + 1, value)
            return ArrayMap.__create(new_data)

    def plus_or_noop_or_replace(self, key: K, value: V) -> "ArrayMap[K, V]":
        index = self._binary_search_key(key)
        if index >= 0:
            if (self.__data[2 * index + 1]) == value:
                return self
            # Replace existing value
            new_data = self.__data[:]
            new_data[2 * index + 1] = value  # Update the value at the correct position
        else:
            # Insert new key-value pair
            insert_at = -(index + 1)
            new_data = self.__data[:]
            new_data.insert(insert_at * 2, key)
            new_data.insert(insert_at * 2 + 1, value)
        return ArrayMap.__create(new_data)

    def __str__(self):
        return "{" + ", ".join(f"{k}: {v}" for k, v in self.items()) + "}"

    def __repr__(self):
        return self.__str__()
