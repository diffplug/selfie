import base64

from abc import ABC, abstractmethod
from typing import Union
from .PerCharacterEscaper import PerCharacterEscaper
from .ParseException import ParseException
from .LineReader import LineReader


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


class SnapshotValueReader:
    KEY_FIRST_CHAR = "╔"
    KEY_START = "╔═ "
    KEY_END = " ═╗"
    FLAG_BASE64 = " ═╗ base64"
    name_esc = PerCharacterEscaper.specified_escape(r"\\[(])\nn\tt╔┌╗┐═─")
    body_esc = PerCharacterEscaper.self_escape("\uD801\uDF43\uD801\uDF41")

    def __init__(self, line_reader):
        self.line_reader = line_reader
        self.line = None
        self.unix_newlines = self.line_reader.unix_newlines()

    def peek_key(self):
        return self.next_key()

    def next_value(self):
        # Validate key
        self.next_key()
        is_base64 = self.FLAG_BASE64 in self.next_line()
        self.reset_line()

        # Read value
        buffer = []

        def consumer(line):
            # Check for special condition and append to buffer accordingly
            if len(line) >= 2 and ord(line[0]) == 0xD801 and ord(line[1]) == 0xDF41:
                buffer.append(self.KEY_FIRST_CHAR)
                buffer.append(line[2:])
            else:
                buffer.append(line)
            buffer.append("\n")

        self.scan_value(consumer)

        raw_string = "".join(buffer).rstrip("\n")

        # Decode or unescape value
        if is_base64:
            decoded_bytes = base64.b64decode(raw_string)
            return SnapshotValue.of(decoded_bytes)
        else:
            return SnapshotValue.of(self.body_esc.unescape(raw_string))

    def skip_value(self):
        self.next_key()
        self.reset_line()
        self.scan_value(lambda line: None)

    def scan_value(self, consumer):
        while True:
            next_line = self.next_line()
            if not next_line or next_line.startswith(self.KEY_FIRST_CHAR):
                break
            consumer(next_line)

    def next_key(self):
        line = self.next_line()
        if line is None:
            return None
        start_index = line.find(self.KEY_START)
        end_index = line.find(self.KEY_END)
        if start_index == -1:
            raise ParseException(
                self.line_reader, f"Expected to start with '{self.KEY_START}'"
            )
        if end_index == -1:
            raise ParseException(
                self.line_reader, f"Expected to contain '{self.KEY_END}'"
            )
        key = line[start_index + len(self.KEY_START) : end_index]
        if key.startswith(" ") or key.endswith(" "):
            space_type = "Leading" if key.startswith(" ") else "Trailing"
            raise ParseException(
                self.line_reader, f"{space_type} spaces are disallowed: '{key}'"
            )
        return self.name_esc.unescape(key) if self.name_esc else key

    def next_line(self):
        line = self.line_reader.read_line()
        return line.rstrip("\r\n") if line else None

    def reset_line(self):
        self.line = None

    @classmethod
    def of(cls, content):
        return cls(LineReader.for_string(content))

    @classmethod
    def of_binary(cls, content):
        return cls(LineReader.for_binary(content))
