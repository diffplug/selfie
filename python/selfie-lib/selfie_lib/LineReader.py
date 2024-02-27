from typing import Optional, Union
import io

class LineReader:
    def __init__(self, source: Union[bytes, str]):  # Handling both binary and text input
        if isinstance(source, bytes):
            self._reader = io.BufferedReader(io.BytesIO(source))
        else:  # It's already a str, so we use StringIO for text
            self._reader = io.StringIO(source)
        self._unix_newlines = True

    @staticmethod
    def for_binary(content: bytes) -> 'LineReader':
        """Creates a LineReader for binary content."""
        return LineReader(content)

    @staticmethod
    def for_string(content: str) -> 'LineReader':
        """Creates a LineReader for string content."""
        return LineReader(content)

    def read_line(self) -> Optional[str]:
        line = self._reader.readline()
        # Check and convert bytes to str if necessary
        if isinstance(line, bytes):
            line = line.decode('utf-8')
        if line == '':
            return None  # EOF
        if '\r' in line:
            self._unix_newlines = False
        return line.rstrip('\n')

    def unix_newlines(self) -> bool:
        return self._unix_newlines
