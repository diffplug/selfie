from io import StringIO, BufferedReader, TextIOWrapper
import io

class LineTerminatorReader(BufferedReader):
    def __init__(self, reader):
        super().__init__(reader)
        self.unix_newlines = True

    def read(self, size=-1):
        chunk = super().read(size)
        if '\r' in chunk:
            self.unix_newlines = False
        return chunk

    def read_line(self):
        line = super().readline()
        if '\r' in line:
            self.unix_newlines = False
        return line.rstrip('\n').rstrip('\r')

    def unix_newlines(self):
        return self.unix_newlines

class LineReader:
    def __init__(self, reader):
        self.reader = LineTerminatorReader(reader)
        self.line_number = 0

    @classmethod
    def for_string(cls, content):
        return cls(StringIO(content))

    @classmethod
    def for_binary(cls, content):
        return cls(TextIOWrapper(io.BytesIO(content), encoding='utf-8'))

    def get_line_number(self):
        return self.line_number

    def read_line(self):
        line = self.reader.read_line()
        if line:
            self.line_number += 1
        return line

    def unix_newlines(self):
        return self.reader.unix_newlines()

