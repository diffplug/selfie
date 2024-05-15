from enum import Enum, auto


class EscapeLeadingWhitespace(Enum):
    ALWAYS = auto()
    NEVER = auto()
    ONLY_ON_SPACE = auto()
    ONLY_ON_TAB = auto()

    def escape_line(self, line: str, space: str, tab: str) -> str:
        if line.startswith(" "):
            if (
                self == EscapeLeadingWhitespace.ALWAYS
                or self == EscapeLeadingWhitespace.ONLY_ON_SPACE
            ):
                return f"{space}{line[1:]}"
            else:
                return line
        elif line.startswith("\t"):
            if (
                self == EscapeLeadingWhitespace.ALWAYS
                or self == EscapeLeadingWhitespace.ONLY_ON_TAB
            ):
                return f"{tab}{line[1:]}"
            else:
                return line
        else:
            return line

    @classmethod
    def appropriate_for(cls, file_content: str) -> "EscapeLeadingWhitespace":
        MIXED = "m"
        common_whitespace = None

        for line in file_content.splitlines():
            whitespace = "".join(c for c in line if c.isspace())
            if not whitespace:
                continue
            elif all(c == " " for c in whitespace):
                whitespace = " "
            elif all(c == "\t" for c in whitespace):
                whitespace = "\t"
            else:
                whitespace = MIXED

            if common_whitespace is None:
                common_whitespace = whitespace
            elif common_whitespace != whitespace:
                common_whitespace = MIXED
                break

        if common_whitespace == " ":
            return cls.ONLY_ON_TAB
        elif common_whitespace == "\t":
            return cls.ONLY_ON_SPACE
        else:
            return cls.ALWAYS
