from enum import Enum, auto


class EscapeLeadingWhitespace(Enum):
    NEVER = auto()

    def escape_line(self, line: str, space: str, tab: str) -> str:
        return line

    @staticmethod
    def appropriate_for(file_content: str) -> "EscapeLeadingWhitespace":
        return EscapeLeadingWhitespace.NEVER
