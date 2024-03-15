from enum import Enum, auto
from typing import Protocol, TypeVar
from abc import abstractmethod
from .EscapeLeadingWhitespace import EscapeLeadingWhitespace
import io

T = TypeVar("T")


class Language(Enum):
    PYTHON = auto()

    @classmethod
    def from_filename(cls, filename: str) -> "Language":
        extension = filename.rsplit(".", 1)[-1]
        if extension == "py":
            return cls.PYTHON
        else:
            raise ValueError(f"Unknown language for file {filename}")


class LiteralValue:
    def __init__(self, expected: T | None, actual: T, format: "LiteralFormat") -> None:
        self.expected = expected
        self.actual = actual
        self.format = format


class LiteralFormat(Protocol[T]):
    @abstractmethod
    def encode(
        self, value: T, language: Language, encoding_policy: "EscapeLeadingWhitespace"
    ) -> str:
        raise NotImplementedError("Subclasses must implement the encode method")

    @abstractmethod
    def parse(self, string: str, language: Language) -> T:
        raise NotImplementedError("Subclasses must implement the parse method")


MAX_RAW_NUMBER = 1000
PADDING_SIZE = len(str(MAX_RAW_NUMBER)) - 1


def _encode_underscores(
    buffer: io.StringIO, value: int, language: Language
) -> io.StringIO:
    if value >= MAX_RAW_NUMBER:
        mod = value % MAX_RAW_NUMBER
        left_padding = PADDING_SIZE - len(str(mod))
        _encode_underscores(buffer, value // MAX_RAW_NUMBER, language)
        buffer.write("_")
        buffer.write("0" * left_padding)
        buffer.write(str(mod))
        return buffer
    elif value < 0:
        buffer.write("-")
        _encode_underscores(buffer, abs(value), language)
        return buffer
    else:
        buffer.write(str(value))
        return buffer


class LiteralInt(LiteralFormat[int]):
    def encode(
        self, value: int, language: Language, encoding_policy: EscapeLeadingWhitespace
    ) -> str:
        return _encode_underscores(io.StringIO(), value, language).getvalue()

    def parse(self, string: str, language: Language) -> int:
        return int(string.replace("_", ""))


class LiteralBoolean(LiteralFormat[bool]):
    def encode(
        self, value: bool, language: Language, encoding_policy: EscapeLeadingWhitespace
    ) -> str:
        return str(value)

    def __to_boolean_strict(self, string: str) -> bool:
        if string.lower() == "true":
            return True
        elif string.lower() == "false":
            return False
        else:
            raise ValueError("String is not a valid boolean representation: " + string)

    def parse(self, string: str, language: Language) -> bool:
        return self.__to_boolean_strict(string)
