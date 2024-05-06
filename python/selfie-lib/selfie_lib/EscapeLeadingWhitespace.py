from enum import Enum, auto


class EscapeLeadingWhitespace(Enum):
    NEVER = auto()

    def escape_line(self, line: str, space: str, tab: str) -> str:  # noqa: ARG002
        return line

    @staticmethod
    def appropriate_for(file_content: str) -> "EscapeLeadingWhitespace":  # noqa: ARG004
        return EscapeLeadingWhitespace.NEVER
