class EscapeLeadingWhitespace:
    NEVER = "NEVER"

    def __init__(self):
        self.escape_type = self.NEVER

    def escape_line(self, line: str, space: str, tab: str) -> str:
        return line

    @staticmethod
    def appropriate_for(file_content: str) -> "EscapeLeadingWhitespace":
        return EscapeLeadingWhitespace()
