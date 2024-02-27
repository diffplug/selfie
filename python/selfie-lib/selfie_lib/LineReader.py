from typing import Optional, Union
from io import TextIOWrapper, StringIO, BytesIO, BufferedReader

class LineTerminatorReader:
    """
    Reads from an underlying buffer and detects Unix-style newlines.
    """
    def __init__(self, reader: Union[TextIOWrapper, BufferedReader, StringIO, BytesIO]) -> None:
        # Wrap the reader appropriately based on its type
        if isinstance(reader, (StringIO, BytesIO)):
            self.reader: Union[StringIO, BytesIO] = reader
        elif isinstance(reader, (TextIOWrapper, BufferedReader)):
            self.reader = reader
        else:
            raise ValueError("Unsupported reader type")
        self.unix_newlines: bool = True

    def read(self, size: int = -1) -> str:
        chunk: str = self.reader.read(size)
        if '\r' in chunk:
            self.unix_newlines = False
        return chunk

    def readline(self) -> Optional[str]:
        line: str = self.reader.readline()
        if '\r' in line:
            self.unix_newlines = False
        return line.strip('\r\n')

    def unix_newlines(self) -> bool:
        return self.unix_newlines

class LineReader:
    """
    Facilitates reading lines from a string or binary content, detecting newline style.
    """
    def __init__(self, source: Union[str, bytes]) -> None:
        if isinstance(source, str):
            reader = StringIO(source)
        elif isinstance(source, bytes):
            reader = BytesIO(source)
        else:
            raise ValueError("Source must be either 'str' or 'bytes'.")
        self.terminator_reader: LineTerminatorReader = LineTerminatorReader(reader)

    @classmethod
    def for_string(cls, content: str) -> 'LineReader':
        return cls(content)

    @classmethod
    def for_binary(cls, content: bytes) -> 'LineReader':
        return cls(content)

    def read_line(self) -> Optional[str]:
        return self.terminator_reader.readline()

    def unix_newlines(self) -> bool:
        return self.terminator_reader.unix_newlines()
