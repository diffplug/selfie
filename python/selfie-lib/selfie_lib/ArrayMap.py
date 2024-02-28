from collections.abc import Set, Sequence, Iterator, Mapping
from typing import List, TypeVar
from functools import cmp_to_key
from abc import ABC, abstractmethod

T = TypeVar('T')
V = TypeVar('V')
K = TypeVar('K', bound='Comparable')

class Comparable(ABC):
    def __lt__(self, other: 'Comparable') -> bool: ...
    def __le__(self, other: 'Comparable') -> bool: ...
    def __gt__(self, other: 'Comparable') -> bool: ...
    def __ge__(self, other: 'Comparable') -> bool: ...

class ListBackedSet(Set[T], Sequence[T], ABC):
    @abstractmethod
    def __len__(self) -> int: ...

    @abstractmethod
    def __getitem__(self, index: int) -> T: ...

    def __iter__(self) -> Iterator[T]:
        for i in range(len(self)):
            yield self[i]

    def __contains__(self, item: object) -> bool:
        for i in range(len(self)):
            if self[i] == item:
                return True
        return False

class ArraySet(ListBackedSet[K]):
    def __init__(self, data: List[K]):
        self.__data = data
        self.__sort_data()

    def __sort_data(self):
        if self.__data and isinstance(self.__data[0], Comparable):
            self.__data.sort(key=cmp_to_key(self.__string_slash_first_comparator))
        else:
            self.__data.sort()

    def __string_slash_first_comparator(self, a: K, b: K) -> int:
        if a == '/':
            return -1
        elif b == '/':
            return 1
        else:
            return (a > b) - (a < b)

    def __len__(self) -> int:
        return len(self.__data)

    def __getitem__(self, index: int) -> K:
        return self.__data[index]

class ArrayMap(Mapping[K, V]):
    def __init__(self, data: list):
        self.data = data

    @classmethod
    def empty(cls):
        return cls([])

    def __getitem__(self, key: K) -> V:
        index = self._binary_search_key(key)
        if index >= 0:
            return self.data[2 * index + 1]
        raise KeyError(key)

    def __iter__(self) -> Iterator[K]:
        return (self.data[i] for i in range(0, len(self.data), 2))

    def __len__(self) -> int:
        return len(self.data) // 2

    def _binary_search_key(self, key: K) -> int:
        low, high = 0, (len(self.data) // 2) - 1
        while low <= high:
            mid = (low + high) // 2
            mid_key = self.data[2 * mid]
            if mid_key < key:
                low = mid + 1
            elif mid_key > key:
                high = mid - 1
            else:
                return mid
        return -(low + 1)

    def plus(self, key: K, value: V) -> 'ArrayMap[K, V]':
        index = self._binary_search_key(key)
        if index >= 0:
            raise ValueError("Key already exists")
        insert_at = -(index + 1)
        new_data = self.data[:]
        new_data[insert_at * 2:insert_at * 2] = [key, value]
        return ArrayMap(new_data)

    def minus_sorted_indices(self, indicesToRemove: List[int]) -> 'ArrayMap[K, V]':
        if not indicesToRemove:
            return self
        newData = []
        for i in range(0, len(self.data), 2):
            if i // 2 not in indicesToRemove:
                newData.extend(self.data[i:i + 2])
        return ArrayMap(newData)
