from typing import Optional, Union
import io

class LineReader:
    """A line reader that is aware of line numbers and can detect Unix-style newlines."""

    def __init__(self, source: Union[str, bytes]) -> None:
        # Initialize the reader based on the type of source (string or bytes)
        if isinstance(source, bytes):
            self._reader = io.BufferedReader(io.BytesIO(source))
        else:
            self._reader = io.StringIO(source)
        self._line_number = 0
        self._unix_newlines = True

    def read_line(self) -> Optional[str]:
        """Reads the next line from the source."""
        line = self._reader.readline()
        if line:
            self._line_number += 1
            # Check for Unix newlines (only '\n' should be present)
            if '\r' in line:
                self._unix_newlines = False
            return line
        return None

    def get_line_number(self):  # type: () -> int
        """Returns the current line number."""
        return self._line_number

    def unix_newlines(self):  # type: () -> bool
        """Checks if the read lines contain only Unix-style newlines."""
        return self._unix_newlines

    @staticmethod
    def for_string(content: str):  # type: (str) -> LineReader
        """Creates a LineReader for a string."""
        return LineReader(content)

    @staticmethod
    def for_binary(content: bytes):  # type: (bytes) -> LineReader
        """Creates a LineReader for binary content."""
        return LineReader(content)
