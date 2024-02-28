import io

class LineReader:
    def __init__(self, content: bytes):
        self.buffer = io.BytesIO(content)
        # Making the method private as per the comment
        self.uses_unix_newlines = self._detect_newline_type()
        self.line_count = 0  # Initialize line count

    @classmethod
    def for_binary(cls, content: bytes):
        return cls(content)
    
    @classmethod
    def for_string(cls, content: str):
        return cls(content.encode('utf-8'))

    # Now a private method
    def _detect_newline_type(self) -> bool:
        first_line = self.buffer.readline()
        self.buffer.seek(0)  # Reset buffer for actual reading
        return b'\r\n' not in first_line

    def unix_newlines(self) -> bool:
        return self.uses_unix_newlines

    def read_line(self) -> str:
        line_bytes = self.buffer.readline()
        if line_bytes:
            self.line_count += 1  # Increment line count for each line read
        line = line_bytes.decode('utf-8')
        return line.rstrip('\r\n' if not self.uses_unix_newlines else '\n')

    # Method to get the current line number
    def get_line_number(self) -> int:
        return self.line_count
