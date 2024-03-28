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
    def of(value: Union[bytes, str]) -> "SnapshotValue":
        if isinstance(value, bytes):
            return SnapshotValueBinary(value)
        elif isinstance(value, str):
            return SnapshotValueString(unix_newlines(value))
        else:
            raise TypeError("Value must be either bytes or str")
        

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