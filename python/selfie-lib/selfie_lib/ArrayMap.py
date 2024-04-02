from collections.abc import Set, Iterator, Mapping
from typing import List, TypeVar, Union, Any
from abc import abstractmethod, ABC
from functools import total_ordering

T = TypeVar("T")
V = TypeVar("V")
K = TypeVar("K")


@total_ordering
class Comparable:
    def __init__(self, value):
        self.value = value

    def __lt__(self, other: Any) -> bool:
        if not isinstance(other, Comparable):
            return NotImplemented
        return self.value < other.value

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, Comparable):
            return NotImplemented
        return self.value == other.value


class ListBackedSet(Set[T], ABC):
    @abstractmethod
    def __len__(self) -> int: ...

    @abstractmethod
    def __getitem__(self, index: Union[int, slice]) -> Union[T, List[T]]: ...

    def __contains__(self, item: Any) -> bool:
        return self._binary_search(item) >= 0

    def _binary_search(self, item: Any) -> int:
        low = 0
        high = len(self) - 1
        while low <= high:
            mid = (low + high) // 2
            try:
                mid_val = self[mid]
                if mid_val < item:
                    low = mid + 1
                elif mid_val > item:
                    high = mid - 1
                else:
                    return mid  # item found
            except TypeError:
                raise ValueError(f"Cannot compare items due to a type mismatch.")
        return -(low + 1)  # item not found


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
        if element in self:
            return self
        else:
            new_data = self.__data[:]
            new_data.append(element)
            new_data.sort(key=Comparable)
            return ArraySet.__create(new_data)


class ArrayMap(Mapping[K, V]):
    def __init__(self, data=None):
        if data is None:
            self.__data = []
        else:
            self.__data = data

    @classmethod
    def empty(cls) -> "ArrayMap[K, V]":
        if not hasattr(cls, "__EMPTY"):
            cls.__EMPTY = cls([])
        return cls.__EMPTY

    def __getitem__(self, key: K) -> V:
        index = self._binary_search_key(key)
        if index >= 0:
            return self.__data[2 * index + 1]
        raise KeyError(key)

    def __iter__(self) -> Iterator[K]:
        return (self.__data[i] for i in range(0, len(self.__data), 2))

    def __len__(self) -> int:
        return len(self.__data) // 2

    def _binary_search_key(self, key: K) -> int:
        def compare(a, b):
            """Comparator that puts '/' first in strings."""
            if isinstance(a, str) and isinstance(b, str):
                a, b = a.replace("/", "\0"), b.replace("/", "\0")
            return (a > b) - (a < b)

        low, high = 0, len(self.__data) // 2 - 1
        while low <= high:
            mid = (low + high) // 2
            mid_key = self.__data[2 * mid]
            comparison = compare(mid_key, key)
            if comparison < 0:
                low = mid + 1
            elif comparison > 0:
                high = mid - 1
            else:
                return mid  # key found
        return -(low + 1)  # key not found

    def plus(self, key: K, value: V) -> "ArrayMap[K, V]":
        index = self._binary_search_key(key)
        if index >= 0:
            raise ValueError("Key already exists")
        insert_at = -(index + 1)
        new_data = self.__data[:]
        new_data.insert(insert_at * 2, key)
        new_data.insert(insert_at * 2 + 1, value)
        return ArrayMap(new_data)

    def minus_sorted_indices(self, indices: List[int]) -> "ArrayMap[K, V]":
        new_data = self.__data[:]
        adjusted_indices = [i * 2 for i in indices] + [i * 2 + 1 for i in indices]
        adjusted_indices.sort()
        for index in reversed(adjusted_indices):
            del new_data[index]
        return ArrayMap(new_data)
