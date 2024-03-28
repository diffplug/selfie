from abc import ABC, abstractmethod
from typing import Union
# from .SnapshotValueBinary import SnapshotValueBinary
# from .SnapshotValueString import SnapshotValueString

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
    def of(cls, data):
        if isinstance(data, bytes):
            return cls(SnapshotValue.of(data), {})
        elif isinstance(data, str):
            return cls(SnapshotValue.of(data), {})
        elif isinstance(data, SnapshotValue):
            return cls(data, {})
        else:
            raise TypeError("Unsupported type for Snapshot creation")
        

class SnapshotValueBinary(SnapshotValue):
    def __init__(self, value: bytes):
        self._value = value

    def value_binary(self) -> bytes:
        return self._value

    def value_string(self) -> str:
        raise NotImplementedError("This is a binary value.")
    

class SnapshotValueString(SnapshotValue):
    def __init__(self, value: str):
        self._value = value

    def value_binary(self) -> bytes:
        raise NotImplementedError("This is a string value.")

    def value_string(self) -> str:
        return self._value