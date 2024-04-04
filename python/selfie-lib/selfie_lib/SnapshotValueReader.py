import base64
from typing import Callable, List, Optional
from .PerCharacterEscaper import PerCharacterEscaper
from .ParseException import ParseException
from .LineReader import LineReader
from .SnapshotValue import SnapshotValue


def unix_newlines(string: str) -> str:
    return string.replace("\r\n", "\n")


class SnapshotValueReader:
    KEY_FIRST_CHAR = "╔"
    KEY_START = "╔═ "
    KEY_END = " ═╗"
    FLAG_BASE64 = " ═╗ base64"
    name_esc = PerCharacterEscaper.specified_escape("\\\\[(])\nn\tt╔┌╗┐═─")
    body_esc = PerCharacterEscaper.self_escape("\ud801\udf43\ud801\udf41")

    def __init__(self, line_reader: LineReader):
        self.line_reader = line_reader
        self.line: str | None = None
        self.unix_newlines = self.line_reader.unix_newlines()

    def peek_key(self) -> str | None:
        return self.__next_key()

    def next_value(self) -> SnapshotValue:
        # Validate key
        self.__next_key()
        nextLineCheckForBase64: Optional[str] = self.__next_line()
        if nextLineCheckForBase64 is None:
            raise ParseException(self.line_reader, "Expected to validate key")
        is_base64: bool = self.FLAG_BASE64 in nextLineCheckForBase64
        self.__reset_line()

        # Read value
        buffer: List[str] = []

        def consumer(line: str) -> None:
            # Check for special condition and append to buffer accordingly
            if len(line) >= 2 and ord(line[0]) == 0xD801 and ord(line[1]) == 0xDF41:
                buffer.append(self.KEY_FIRST_CHAR)
                buffer.append(line[2:])
            else:
                buffer.append(line)
            buffer.append("\n")

        self.__scan_value(consumer)

        raw_string: str = "" if buffer.__len__() == 0 else ("".join(buffer))[:-1]

        # Decode or unescape value
        if is_base64:
            decoded_bytes: bytes = base64.b64decode(raw_string)
            return SnapshotValue.of(decoded_bytes)
        else:
            return SnapshotValue.of(self.body_esc.unescape(raw_string))

    def skip_value(self) -> None:
        self.__next_key()
        self.__reset_line()
        self.__scan_value(lambda line: None)

    def __scan_value(self, consumer: Callable[[str], None]) -> None:
        nextLine: Optional[str] = self.__next_line()
        while (
            nextLine is not None
            and nextLine.find(SnapshotValueReader.KEY_FIRST_CHAR) != 0
        ):
            self.__reset_line()
            consumer(nextLine)
            nextLine = self.__next_line()

    def __next_key(self) -> Optional[str]:
        line: Optional[str] = self.__next_line()
        if line is None:
            return None
        start_index: int = line.find(self.KEY_START)
        end_index: int = line.find(self.KEY_END)
        if start_index == -1:
            raise ParseException(
                self.line_reader, f"Expected to start with '{self.KEY_START}'"
            )
        if end_index == -1:
            raise ParseException(
                self.line_reader, f"Expected to contain '{self.KEY_END}'"
            )
        key: str = line[start_index + len(self.KEY_START) : end_index]
        if key.startswith(" ") or key.endswith(" "):
            space_type = "Leading" if key.startswith(" ") else "Trailing"
            raise ParseException(
                self.line_reader, f"{space_type} spaces are disallowed: '{key}'"
            )
        return self.name_esc.unescape(key)

    def __next_line(self) -> Optional[str]:
        if self.line is None:
            self.line = self.line_reader.read_line()
        return self.line

    def __reset_line(self) -> None:
        self.line = None

    @classmethod
    def of(cls, content: str) -> "SnapshotValueReader":
        return cls(LineReader.for_string(content))

    @classmethod
    def of_binary(cls, content: bytes) -> "SnapshotValueReader":
        return cls(LineReader.for_binary(content))
