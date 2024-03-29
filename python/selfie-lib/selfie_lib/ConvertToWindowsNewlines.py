class ConvertToWindowsNewlines:
    def __init__(self, sink):
        self.sink = sink

    def append(self, value, start_index=None, end_index=None):
        # If value is a single character
        if isinstance(value, str) and len(value) == 1:
            if value != "\n":
                self.sink.write(value)
            else:
                self.sink.write("\r\n")
        # If value is a CharSequence (in Python, a str)
        elif isinstance(value, str):
            # If start_index and end_index are provided, use the slice of the string
            if start_index is not None and end_index is not None:
                value_to_append = value[start_index:end_index]
            else:
                value_to_append = value
            self.sink.write(value_to_append.replace("\n", "\r\n"))
        return self
