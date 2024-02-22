
from typing import Optional, BinaryIO
from io import StringIO, BufferedReader

class LineTerminatorReader:
    def __init__(self, reader: BufferedReader):
        self.reader = reader
        self.unix_newlines = True

    def read(self, size: int = -1) -> str:
        result = self.reader.read(size)
        self.unix_newlines = '\r' not in result
        return result

    def read_line(self) -> Optional[str]:
        line = self.reader.readline()
        if line == '':
            return None
        self.unix_newlines = '\r' not in line
        return line

    def unix_newlines(self) -> bool:
        return self.unix_newlines

class LineReader:
    def __init__(self, reader: BufferedReader):
        self.reader = LineTerminatorReader(reader)
        self.line_number = 0

    @classmethod
    def for_string(cls, content: str) -> 'LineReader':
        return cls(StringIO(content))

    @classmethod
    def for_binary(cls, content: bytes) -> 'LineReader':
        return cls(BufferedReader(content))

    def get_line_number(self) -> int:
        return self.line_number

    def read_line(self) -> Optional[str]:
        line = self.reader.read_line()
        if line is not None:
            self.line_number += 1
        return line

    def unix_newlines(self) -> bool:
        return self.reader.unix_newlines()
