from enum import Enum


class EscapeLeadingWhitespace(Enum):
    NEVER = "NEVER"

    def __init__(self, escape_type):
        self.escape_type = escape_type

    def escape_line(self, line: str, space: str, tab: str) -> str:
        return line

    @staticmethod
    def appropriate_for(file_content: str) -> "EscapeLeadingWhitespace":
        return EscapeLeadingWhitespace.NEVER
