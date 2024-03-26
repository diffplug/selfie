import io


class LineReader:
    def __init__(self, content: bytes):
        self.__buffer = io.BytesIO(content)
        self.__uses_unix_newlines = self.__detect_newline_type()
        self.__line_count = 0  # Initialize line count

    @classmethod
    def for_binary(cls, content: bytes):
        return cls(content)

    @classmethod
    def for_string(cls, content: str):
        return cls(content.encode("utf-8"))

    def __detect_newline_type(self) -> bool:
        first_line = self.__buffer.readline()
        self.__buffer.seek(0)  # Reset buffer for actual reading
        return b"\r\n" not in first_line

    def unix_newlines(self) -> bool:
        return self.__uses_unix_newlines

    def read_line(self) -> str | None:
        line_bytes = self.__buffer.readline()
        if line_bytes == b"":
            return None
        else:
            self.__line_count += 1  # Increment line count for each line read
            line = line_bytes.decode("utf-8")
            return line.rstrip("\r\n" if not self.__uses_unix_newlines else "\n")

    # Method to get the current line number
    def get_line_number(self) -> int:
        return self.__line_count
