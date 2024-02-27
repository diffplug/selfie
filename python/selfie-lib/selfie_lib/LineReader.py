from typing import Optional, Union
import io

class LineTerminatorReader(io.BufferedReader):
    """Overrides read operations to detect carriage returns."""
    def __init__(self, reader: io.TextIOWrapper) -> None:
        super().__init__(reader.buffer)
        self._unix_newlines = True

    def read(self, size: int = -1) -> bytes:
        chunk = super().read(size)
        if b'\r' in chunk:
            self._unix_newlines = False
        return chunk

    def unix_newlines(self) -> bool:
        """Check if the newlines are Unix style."""
        return self._unix_newlines

class LineTerminatorAware(io.TextIOWrapper):
    """Keeps track of the first line to determine newline style."""
    def __init__(self, reader: LineTerminatorReader) -> None:
        super().__init__(reader, encoding='utf-8')
        self._first_line: Optional[str] = self.readline()

    def readline(self, limit: int = -1) -> str:
        if self._first_line is not None:
            result, self._first_line = self._first_line, None
            return result
        return super().readline(limit)

class LineReader:
    """A reader that is aware of line terminators and line numbers."""
    def __init__(self, reader: Union[io.StringIO, io.BufferedReader]) -> None:
        self._reader = LineTerminatorAware(LineTerminatorReader(reader))

    @staticmethod
    def for_string(content: str) -> 'LineReader':
        """Create a LineReader for string content."""
        return LineReader(io.StringIO(content))

    @staticmethod
    def for_binary(content: bytes) -> 'LineReader':
        """Create a LineReader for binary content."""
        return LineReader(io.BufferedReader(io.BytesIO(content)))

    def get_line_number(self) -> int:
        """Get the current line number."""
        # Assuming a way to track line numbers or using a wrapper that does.
        # This is a placeholder as Python's io does not provide a direct lineno attribute.
        return 0

    def read_line(self) -> Optional[str]:
        """Read the next line from the reader."""
        return self._reader.readline()

    def unix_newlines(self) -> bool:
        """Check if the reader uses Unix newlines."""
        return self._reader.unix_newlines()
