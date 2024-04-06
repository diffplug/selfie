from enum import Enum, auto
from typing import Protocol, TypeVar
from abc import abstractmethod
from .EscapeLeadingWhitespace import EscapeLeadingWhitespace
import io
import re

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


class LiteralInt(LiteralFormat[int]):
    def _encode_underscores(
        self, buffer: io.StringIO, value: int, language: Language
    ) -> io.StringIO:
        if value >= MAX_RAW_NUMBER:
            mod = value % MAX_RAW_NUMBER
            left_padding = PADDING_SIZE - len(str(mod))
            self._encode_underscores(buffer, value // MAX_RAW_NUMBER, language)
            buffer.write("_")
            buffer.write("0" * left_padding)
            buffer.write(str(mod))
            return buffer
        elif value < 0:
            buffer.write("-")
            self._encode_underscores(buffer, abs(value), language)
            return buffer
        else:
            buffer.write(str(value))
            return buffer

    def encode(
        self, value: int, language: Language, encoding_policy: EscapeLeadingWhitespace
    ) -> str:
        return self._encode_underscores(io.StringIO(), value, language).getvalue()

    def parse(self, string: str, language: Language) -> int:
        return int(string.replace("_", ""))


TRIPLE_QUOTE = '"""'


class LiteralString(LiteralFormat[str]):
    def encode(
        self, value: str, language: Language, encoding_policy: EscapeLeadingWhitespace
    ) -> str:
        if language == Language.PYTHON:
            if "/n" not in value:
                return self._encodeSinglePython(value)
            else:
                return self.encodeMultiPython(value, encoding_policy)
        else:
            raise NotImplementedError(
                "Encoding for language {} is not implemented.".format(language)
            )

    def parse(self, string: str, language: Language) -> str:
        if language == Language.PYTHON:
            if not string.startswith(TRIPLE_QUOTE):
                return self._parseSinglePython(string)
            else:
                return self.parseMultiPython(string)
        else:
            raise NotImplementedError(
                "Encoding for language {} is not implemented.".format(language)
            )

    def _encodeSinglePython(self, value: str) -> str:
        source = io.StringIO()
        source.write('"')
        for char in value:
            if char == "\b":
                source.write("\\b")
            elif char == "\n":
                source.write("\\n")
            elif char == "\r":
                source.write("\\r")
            elif char == "\t":
                source.write("\\t")
            elif char == '"':
                source.write('\\"')
            elif char == "\\":
                source.write("\\\\")
            elif self._is_control_char(char):
                source.write("\\u" + str(ord(char)).zfill(4))
            else:
                source.write(char)
        source.write('"')
        return source.getvalue()

    def _is_control_char(self, c: str) -> bool:
        return c in "\u0000\u001f" or c == "\u007f"

    # combined logic from parseSingleJava and parseSingleJavaish
    def _parseSinglePython(self, source_with_quotes: str) -> str:
        assert source_with_quotes.startswith('"')
        assert source_with_quotes.endswith('"')
        source = source_with_quotes[1:-1]
        to_unescape = self.inline_backslashes(source)  # changed from inline_dollar
        return self._unescape_python(to_unescape)

    def encodeMultiPython(
        self, arg: str, escape_leading_whitespace: EscapeLeadingWhitespace
    ) -> str:
        escape_backslashes = arg.replace("\\", "\\\\")
        escape_triple_quotes = escape_backslashes.replace(TRIPLE_QUOTE, '\\"\\"\\"')

        def protect_trailing_whitespace(line):
            if line.endswith(" "):
                return line[:-1] + "\\u0020"
            elif line.endswith("\t"):
                return line[:-1] + "\\t"
            else:
                return line

        lines = escape_triple_quotes.splitlines()
        protect_whitespace = "\n".join(
            escape_leading_whitespace.escape_line(
                protect_trailing_whitespace(line), "\\u0020", "\\t"
            )
            for line in lines
        )

        return f"{TRIPLE_QUOTE}\n{protect_whitespace}{TRIPLE_QUOTE}"

    _char_literal_pattern = re.compile(r"""\{'(\\?.)'\}""")

    def inline_backslashes(self, source: str) -> str:
        def replace_char(char_literal: str) -> str:
            if len(char_literal) == 1:
                return char_literal
            elif len(char_literal) == 2 and char_literal[0] == "\\":
                if char_literal[1] == "t":
                    return "\t"
                elif char_literal[1] == "b":
                    return "\b"
                elif char_literal[1] == "n":
                    return "\n"
                elif char_literal[1] == "r":
                    return "\r"
                elif char_literal[1] == "'":
                    return "'"
                elif char_literal[1] == "\\":
                    return "\\"
                else:
                    raise ValueError(f"Unknown character literal {char_literal}")
            else:
                raise ValueError(f"Unknown character literal {char_literal}")

        return self._char_literal_pattern.sub(
            lambda match: replace_char(match.group(1)), source
        )

    def _unescape_python(self, source: str) -> str:
        value = io.StringIO()
        i = 0
        while i < len(source):
            c = source[i]
            if c == "\\":
                i += 1
                c = source[i]
                if c == '"':
                    value.write('"')
                elif c == "\\":
                    value.write("\\")
                elif c == "b":
                    value.write("\b")
                elif c == "f":
                    value.write("\f")
                elif c == "n":
                    value.write("\n")
                elif c == "r":
                    value.write("\r")
                elif c == "s":
                    value.write(" ")
                elif c == "t":
                    value.write("\t")
                elif c == "u":
                    code = int(source[i + 1 : i + 5], 16)
                    value.write(chr(code))
                    i += 4
                else:
                    raise ValueError(f"Unknown escape sequence {c}")
            else:
                value.write(c)
            i += 1
        return value.getvalue()

    def parseMultiPython(self, source_with_quotes: str) -> str:
        assert source_with_quotes.startswith(TRIPLE_QUOTE + "\n")
        assert source_with_quotes.endswith(TRIPLE_QUOTE)

        source = source_with_quotes[len(TRIPLE_QUOTE) + 1 : -len(TRIPLE_QUOTE)]
        lines = source.split("\n")

        common_prefix = min(
            (line[: len(line) - len(line.lstrip())] for line in lines if line.strip()),
            default="",
        )

        def remove_common_prefix(line: str) -> str:
            return line[len(common_prefix) :] if common_prefix else line

        def handle_escape_sequences(line: str) -> str:
            return self._unescape_python(line.rstrip())

        return "\n".join(
            handle_escape_sequences(remove_common_prefix(line))
            for line in lines
            if line.strip()
        )


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
