from collections.abc import Set, Sequence, Iterator, Mapping
from typing import TypeVar, List
from functools import cmp_to_key

T = TypeVar('T')
K = TypeVar('K')
V = TypeVar('V')

class ListBackedSet(Set[T], Sequence[T]):
    def __getitem__(self, index: int) -> T:
        # This method should be implemented by the subclass.
        raise NotImplementedError

    def __len__(self) -> int:
        # This should also be implemented by the subclass to return the number of items.
        raise NotImplementedError

    def __iter__(self) -> Iterator[T]:
        return self.ListBackedSetIterator(self)

    class ListBackedSetIterator(Iterator[T]):
        def __init__(self, list_backed_set: 'ListBackedSet[T]'):
            self.list_backed_set = list_backed_set
            self.index = 0

        def __next__(self) -> T:
            if self.index < len(self.list_backed_set):
                result = self.list_backed_set[self.index]
                self.index += 1
                return result
            else:
                raise StopIteration

    def __contains__(self, item: object) -> bool:
        # Efficient implementation of __contains__ should be provided by subclass if needed.
        for i in self:
            if i == item:
                return True
        return False

class ArraySet(ListBackedSet[K]):
    def __init__(self, data: list):
        self.data = data
        self.sort_data()

    def sort_data(self):
        if self.data and isinstance(self.data[0], str):
            self.data.sort(key=cmp_to_key(self.string_slash_first_comparator))
        else:
            self.data.sort()

    def string_slash_first_comparator(self, a, b):
        # Define sorting where '/' is considered the lowest key
        if a == '/':
            return -1
        elif b == '/':
            return 1
        else:
            return (a > b) - (a < b)

    def __len__(self):
        return len(self.data)

    def __getitem__(self, index: int) -> K:
        return self.data[index]

    def __contains__(self, item: K) -> bool:
        # Implementing binary search for efficiency
        left, right = 0, len(self.data) - 1
        while left <= right:
            mid = (left + right) // 2
            if self.data[mid] == item:
                return True
            elif self.data[mid] < item:
                left = mid + 1
            else:
                right = mid - 1
        return False

    def plus_or_this(self, key: K) -> 'ArraySet[K]':
        # Binary search to find the appropriate index or confirm existence
        left, right = 0, len(self.data) - 1
        while left <= right:
            mid = (left + right) // 2
            if self.data[mid] == key:
                return self  # Key already exists
            elif self.data[mid] < key:
                left = mid + 1
            else:
                right = mid - 1

        # Key does not exist, insert in the sorted position
        new_data = self.data[:left] + [key] + self.data[left:]
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
