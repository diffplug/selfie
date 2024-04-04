from .LineReader import LineReader


class ParseException(Exception):
    def __init__(self, line_reader: LineReader, message: str) -> None:
        self.line: int = line_reader.get_line_number()
        super().__init__(f"Line {self.line}: {message}")
