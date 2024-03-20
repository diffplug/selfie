# import base64

from abc import ABC, abstractmethod
from typing import Union
# from .PerCharacterEscaper import PerCharacterEscaper

def unix_newlines(string: str) -> str:
    return string.replace("\r\n", "\n")

class ParseException(Exception):
    def __init__(self, line_number, message):
        super().__init__(f"L{line_number}:{message}")
        self.line_number = line_number
        self.message = message

class SnapshotValue(ABC):
    @property
    def is_binary(self) -> bool:
        return isinstance(self, SnapshotValueBinary)

    @abstractmethod
    def value_binary(self) -> bytes:
        pass

    @abstractmethod
    def value_string(self) -> str:
        pass

    @staticmethod
    def of(value: Union[bytes, str]) -> 'SnapshotValue':
        if isinstance(value, bytes):
            return SnapshotValueBinary(value)
        elif isinstance(value, str):
            return SnapshotValueString(unix_newlines(value))
        else:
            raise TypeError("Value must be either bytes or str")

class SnapshotValueBinary(SnapshotValue):
    def __init__(self, value: bytes):
        self._value = value

    def value_binary(self) -> bytes:
        return self._value

    def value_string(self) -> str:
        raise NotImplementedError("This is a binary value.")

class SnapshotValueString(SnapshotValue):
    def __init__(self, value: str):
        self._value = value

    def value_binary(self) -> bytes:
        raise NotImplementedError("This is a string value.")

    def value_string(self) -> str:
        return self._value

class SnapshotValueReader:
    KEY_FIRST_CHAR = '╔'
    KEY_START = "╔═ "
    KEY_END = " ═╗"
    FLAG_BASE64 = " ═╗ base64"
    
    def __init__(self, content):
        self.content = content.split("\n")
        self.current_line = 0  

    @classmethod
    def of(cls, content):
        return cls(content)
    
    def peekKey(self):
        # Temporarily save the current state
        temp_line = self.current_line

        # Attempt to read the next key
        key = self.nextKey()

        # Restore the original state
        self.current_line = temp_line
        return key

    def nextValue(self):
        value_lines = []
        while True:
            # Peek at the next line without advancing self.current_line
            next_line = self.content[self.current_line] if self.current_line < len(self.content) else None
            
            # Check if the next line starts a new key
            if next_line is None or self._is_start_of_new_key(next_line):
                break  # Found the start of a new key or reached the end of content

            # Since it's not a new key, read the line to include it in the value
            value_lines.append(self._read_line())

        value_string = "\n".join(value_lines).strip()
        return SnapshotValue.of(value_string) 

    def _is_start_of_new_key(self, line):
        # Simplified key start detection; might need more robust logic for complex cases
        return line.startswith("╔═ ") and " ═╗" in line



    def skip_value(self):
        self.next_key()
        self.reset_line()
        self.scan_value(lambda _: None)

    def scan_value(self, consumer):
        next_line = self.next_line()
        while next_line and not next_line.startswith(self.KEY_FIRST_CHAR):
            self.reset_line()
            consumer(next_line)
            next_line = self.next_line()

    def nextKey(self):
        line = self.nextLine()
        if line is None:
            return None
        if not line.startswith(self.KEY_START):
            raise ParseException(self.current_line, "Expected to start with '╔═ '")
        if not line.endswith(self.KEY_END):
            raise ParseException(self.current_line, "Expected to contain ' ═╗'")

        key = line[len(self.KEY_START): -len(self.KEY_END)]
        if key.startswith(" "):
            raise ParseException(self.current_line, "Leading spaces are disallowed: '{}'".format(key))
        if key.endswith(" "):
            raise ParseException(self.current_line, "Trailing spaces are disallowed: '{}'".format(key))
        
        return self.per_character_escaper.unescape(key) 


    def next_line(self):
        if self.line is None:
            self.line = self.line_reader.read_line()
        return self.line

    def reset_line(self):
        self.line = None

    def processLine(self, line):
        # Process a single line, adjusting for special characters or encoding
        if len(line) >= 2 and line[0] == '\uD801' and line[1] == '\uDF41':  # Using Python's Unicode representation
            return self.KEY_FIRST_CHAR + line[2:] + '\n'
        else:
            return line + '\n'