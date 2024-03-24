class ParseException(Exception):
    def __init__(self, line_reader, message):
        self.line = line_reader.get_line_number()
        super().__init__(f"Line {self.line}: {message}")
