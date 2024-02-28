from collections.abc import Set, Iterator, Mapping
from typing import List, TypeVar, Union
from abc import abstractmethod, ABC

T = TypeVar('T')
V = TypeVar('V')
K = TypeVar('K')

class ListBackedSet(Set[T], ABC):
    @abstractmethod
    def __len__(self) -> int: ...

    @abstractmethod
    def __getitem__(self, index: Union[int, slice]) -> Union[T, List[T]]: ...

    def __contains__(self, item: object) -> bool:
        for i in range(len(self)):
            if self[i] == item:
                return True
        return False

class ArraySet(ListBackedSet[K]):
    __empty_set = None

    def __init__(self, data: List[K]):
        self.__data = []
        for item in data:
            self.plusOrThis(item)

    def __iter__(self) -> Iterator[K]:
        return iter(self.__data)

    @classmethod
    def empty(cls) -> 'ArraySet[K]':
        if cls.__empty_set is None:
            cls.__empty_set = cls([])
        return cls.__empty_set

    def __len__(self) -> int:
        return len(self.__data)

    def __getitem__(self, index: Union[int, slice]) -> Union[K, List[K]]:
        if isinstance(index, int):
            return self.__data[index]
        elif isinstance(index, slice):
            return self.__data[index]
        else:
            raise TypeError("Invalid argument type.")

    def plusOrThis(self, element: K) -> 'ArraySet[K]':
        new_data = []
        added = False
        for item in self.__data:
            if not added and element < item:
                new_data.append(element)
                added = True
            new_data.append(item)
        if not added:
            new_data.append(element)
        return ArraySet(new_data)

class ArrayMap(Mapping[K, V]):
    __empty_map = None

    def __init__(self, data: list):
        self.__data = data

    @classmethod
    def empty(cls) -> 'ArrayMap[K, V]':
        if cls.__empty_map is None:
            cls.__empty_map = cls([])
        return cls.__empty_map

    def __getitem__(self, key: K) -> V:
        index = self.__binary_search_key(key)
        if index >= 0:
            return self.__data[2 * index + 1]
        raise KeyError(key)

    def __iter__(self) -> Iterator[K]:
        return (self.__data[i] for i in range(0, len(self.__data), 2))

    def __len__(self) -> int:
        return len(self.__data) // 2

    def __binary_search_key(self, key: K) -> int: 
        low, high = 0, (len(self.__data) // 2) - 1
        while low <= high:
            mid = (low + high) // 2
            mid_key = self.__data[2 * mid]
            if mid_key < key:
                low = mid + 1
            elif mid_key > key:
                high = mid - 1
            else:
                return mid
        return -(low + 1)

    def plus(self, key: K, value: V) -> 'ArrayMap[K, V]':
        index = self.__binary_search_key(key) 
        if index >= 0:
            raise ValueError("Key already exists")
        insert_at = -(index + 1)
        new_data = self.__data[:]
        new_data[insert_at * 2:insert_at * 2] = [key, value]
        return ArrayMap(new_data)

    def minus_sorted_indices(self, indicesToRemove: List[int]) -> 'ArrayMap[K, V]':
        if not indicesToRemove:
            return self
        newData = []
        for i in range(0, len(self.__data), 2):
            if i // 2 not in indicesToRemove:
                newData.extend(self.__data[i:i + 2])
        return ArrayMap(newData)
