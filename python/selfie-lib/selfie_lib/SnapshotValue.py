from abc import ABC, abstractmethod
from typing import Union, Type


def unix_newlines(string: str) -> str:
    return string.replace("\r\n", "\n")


class SnapshotValue(ABC):
    @property
    def is_binary(self) -> bool:
        return isinstance(self, SnapshotValueBinary)

    @abstractmethod
    def value_binary(self) -> bytes:
        pass

    @abstractmethod
    def value_string(self) -> str:
        pass

    @staticmethod
    def of(data: Union[bytes, str, "SnapshotValue"]) -> "SnapshotValue":
        if isinstance(data, bytes):
            return SnapshotValueBinary(data)
        elif isinstance(data, str):
            return SnapshotValueString(data)
        elif isinstance(data, SnapshotValue):
            return data
        else:
            raise TypeError("Unsupported type for Snapshot creation")


class SnapshotValueBinary(SnapshotValue):
    def __init__(self, value: bytes):
        self._value = value

    def value_binary(self) -> bytes:
        return self._value

    def value_string(self) -> str:
        raise NotImplementedError("This is a binary value.")

    def __eq__(self, other: object) -> bool:
        if isinstance(other, SnapshotValueBinary):
            return self.value_binary() == other.value_binary()
        return False

    def __hash__(self) -> int:
        return hash(self._value)


class SnapshotValueString(SnapshotValue):
    def __init__(self, value: str):
        self._value = value

    def value_binary(self) -> bytes:
        raise NotImplementedError("This is a string value.")

    def value_string(self) -> str:
        return self._value

    def __eq__(self, other: object) -> bool:
        if isinstance(other, SnapshotValueString):
            return self.value_string() == other.value_string()
        return False

    def __hash__(self) -> int:
        return hash(self._value)
