from enum import Enum, auto
from typing import Any
from .EscapeLeadingWhitespace import EscapeLeadingWhitespace


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
    def __init__(self, expected: Any, actual: Any, format: "LiteralFormat") -> None:
        self.expected = expected
        self.actual = actual
        self.format = format


class LiteralFormat:
    def encode(
        self, value: Any, language: Language, encoding_policy: "EscapeLeadingWhitespace"
    ) -> str:
        raise NotImplementedError("Subclasses must implement the encode method")

    def parse(self, string: str, language: Language) -> Any:
        raise NotImplementedError("Subclasses must implement the parse method")


MAX_RAW_NUMBER = 1000
PADDING_SIZE = len(str(MAX_RAW_NUMBER)) - 1


class LiteralBoolean(LiteralFormat):
    def encode(
        self, value: bool, language: Language, encoding_policy: EscapeLeadingWhitespace
    ) -> str:
        return str(value)

    def parse(self, string: str, language: Language) -> bool:
        return string.lower() == "true"
