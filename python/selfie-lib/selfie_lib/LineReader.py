import io

class LineTerminatorAware:
    def __init__(self, reader):
        self.reader = reader
        self.line_number = 0
        self.unix_newlines = True
        self.first_line = self.reader.readline()
        if '\r' in self.first_line:
            self.unix_newlines = False

    def read_line(self):
        if self.first_line:
            line = self.first_line
            self.first_line = None
            self.line_number += 1
            return line
        line = self.reader.readline()
        if line:
            if '\r' in line:
                self.unix_newlines = False
            self.line_number += 1
        return line

    def unix_newlines(self):
        return self.unix_newlines


class LineReader:
    def __init__(self, reader):
        self.reader = LineTerminatorAware(reader)

    @classmethod
    def for_string(cls, content):
        return cls(io.StringIO(content))

    @classmethod
    def for_binary(cls, content):
        return cls(io.BytesIO(content).read().decode('utf-8'))

    def get_line_number(self):
        return self.reader.line_number

    def read_line(self):
        return self.reader.read_line()

    def unix_newlines(self):
        return self.reader.unix_newlines()