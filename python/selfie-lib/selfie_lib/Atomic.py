from typing import Callable, Generic, TypeVar

T = TypeVar("T")


class AtomicReference(Generic[T]):
    """
    This has the same API as Java's AtomicReference, but it doesn't make any sense in the Python runtime.
    The point of keeping it is that it makes the port from Kotlin more 1:1
    """

    def __init__(self, initial_value: T):
        self.value: T = initial_value

    def get(self) -> T:
        return self.value

    def set(self, new_value: T) -> None:
        self.value = new_value

    def get_and_set(self, new_value: T) -> T:
        old_value = self.value
        self.value = new_value
        return old_value

    def compare_and_set(self, expected_value: T, new_value: T) -> bool:
        if self.value == expected_value:
            self.value = new_value
            return True
        return False

    def get_and_update(self, update_function: Callable[[T], T]) -> T:
        old_value = self.value
        self.value = update_function(self.value)
        return old_value

    def update_and_get(self, update_function: Callable[[T], T]) -> T:
        self.value = update_function(self.value)
        return self.value

    def get_and_accumulate(self, x: T, accumulator: Callable[[T, T], T]) -> T:
        old_value = self.value
        self.value = accumulator(self.value, x)
        return old_value

    def accumulate_and_get(self, x: T, accumulator: Callable[[T, T], T]) -> T:
        self.value = accumulator(self.value, x)
        return self.value
