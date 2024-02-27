import io
from typing import Union

class LineReader:
    def __init__(self, content: Union[bytes, str]):
        if isinstance(content, str):
            content = content.encode('utf-8')
        self.buffer = io.BytesIO(content)
        self.uses_unix_newlines = self.detect_newline_type()

    def detect_newline_type(self) -> bool:
        first_line = self.buffer.readline()
        # Reset buffer after checking the first line
        self.buffer.seek(0)
        return b'\r\n' not in first_line

    @classmethod
    def for_binary(cls, content: bytes):
        return cls(content)

    @classmethod
    def for_string(cls, content: str):
        return cls(content)

    def unix_newlines(self) -> bool:
        return self.uses_unix_newlines

    def read_line(self) -> str:
        line = self.buffer.readline().decode('utf-8')
        return line.rstrip('\r\n')


