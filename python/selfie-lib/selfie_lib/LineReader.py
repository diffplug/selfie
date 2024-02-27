import io

class LineTerminatorAware(io.BufferedReader):
    def __init__(self, buffer):
        super().__init__(buffer)
        self.first_line = self.readline()
        self.unix_newlines = True

    def readline(self, *args, **kwargs):
        if self.first_line is not None:
            result = self.first_line
            self.first_line = None
            return result
        return super().readline(*args, **kwargs)

class LineReader:
    def __init__(self, reader):
        self.reader = LineTerminatorAware(LineTerminatorReader(reader))

    @classmethod
    def for_string(cls, content):
        return cls(io.StringIO(content))

    @classmethod
    def for_binary(cls, content):
        return cls(io.BytesIO(content).read().decode('utf-8'))

    def get_line_number(self):
        # Python's io module does not track line numbers directly.
        # This functionality would need to be implemented manually if required.
        pass

    def read_line(self):
        return self.reader.readline()

    def unix_newlines(self):
        return self.reader.unix_newlines

class LineTerminatorReader(io.StringIO):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.unix_newlines = True

    def read(self, *args, **kwargs):
        result = super().read(*args, **kwargs)
        if '\r' in result:
            self.unix_newlines = False
        return result

    def readline(self, *args, **kwargs):
        line = super().readline(*args, **kwargs)
        if '\r' in line:
            self.unix_newlines = False
        return line
