from collections.abc import Set, Sequence, Iterator, Mapping
from typing import List, TypeVar, Union, overload, Sequence as TypeSequence
from functools import cmp_to_key

T = TypeVar('T')
V = TypeVar('V')
K = TypeVar('K', bound='Comparable')

class Comparable:
    def __lt__(self, other: 'Comparable') -> bool: ...
    def __le__(self, other: 'Comparable') -> bool: ...
    def __gt__(self, other: 'Comparable') -> bool: ...
    def __ge__(self, other: 'Comparable') -> bool: ...

class ListBackedSet(Set[T], Sequence[T]):
    def __init__(self):
        self._list: List[T] = []

    @overload
    def __getitem__(self, index: int) -> T: ...
    
    @overload
    def __getitem__(self, index: slice) -> TypeSequence[T]: ...

    def __getitem__(self, index: Union[int, slice]) -> Union[T, TypeSequence[T]]:
        if isinstance(index, int):
            return self._list[index]
        elif isinstance(index, slice):
            return self._list[index]
        else:
            raise TypeError("Index must be int or slice")

    def __len__(self) -> int:
        return len(self._list)

    def __iter__(self) -> Iterator[T]:
        return iter(self._list)

    def __contains__(self, item: object) -> bool:
        return item in self._list

class ArraySet(ListBackedSet[K]):
    def __init__(self, data: List[K]):
        self.__data = data 
        self.__sort_data() 

    def __sort_data(self):
        if self.__data and isinstance(self.__data[0], str):
            self.__data.sort(key=cmp_to_key(self.__string_slash_first_comparator))
        else:
            self.__data.sort()

    def __string_slash_first_comparator(self, a, b):
        if a == '/':
            return -1
        elif b == '/':
            return 1
        else:
            return (a > b) - (a < b)

    def __len__(self):
        return len(self.__data)

    @overload
    def __getitem__(self, index: int) -> K: ...

    @overload
    def __getitem__(self, index: slice) -> 'ArraySet[K]': ...

    def __getitem__(self, index: Union[int, slice]) -> Union[K, 'ArraySet[K]']:
        if isinstance(index, int):
            return self.__data[index]
        elif isinstance(index, slice):
            sliced_data = self.__data[index]
            return ArraySet(sliced_data)
        else:
            raise TypeError("Index must be int or slice")

    def __contains__(self, item: object) -> bool:
        if not isinstance(item, type(self.__data[0])):
            return False
        return item in self.__data 

    def plus_or_this(self, key: K) -> 'ArraySet[K]':
        left, right = 0, len(self.__data) - 1
        while left <= right:
            mid = (left + right) // 2
            if self.__data[mid] == key:
                return self
            elif self.__data[mid] < key:
                left = mid + 1
            else:
                right = mid - 1

        new_data = self.__data[:left] + [key] + self.__data[left:]
        return ArraySet(new_data)

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

    def __iter__(self):
        return (self.data[i] for i in range(0, len(self.data), 2))

    def __len__(self) -> int:
        return len(self.data) // 2

    def _binary_search_key(self, key: K) -> int:
        low, high = 0, len(self.data) // 2 - 1
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
        else:
            insert_at = -(index + 1)
            new_data = self.data[:]
            new_data[insert_at * 2:insert_at * 2] = [key, value]
            return ArrayMap(new_data)

    def minus_sorted_indices(self, indicesToRemove: list[int]) -> 'ArrayMap[K, V]':
        if not indicesToRemove:
            return self
        newData = []
        for i in range(0, len(self.data), 2):
            if i // 2 not in indicesToRemove:
                newData.extend(self.data[i:i + 2])
        return ArrayMap(newData)
