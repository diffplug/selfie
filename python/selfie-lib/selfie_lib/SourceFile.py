from typing import Any

from .EscapeLeadingWhitespace import EscapeLeadingWhitespace
from .Literals import Language, LiteralFormat, LiteralRepr, LiteralValue
from .Slice import Slice


class SourceFile:
    TRIPLE_QUOTE = '"""'

    def __init__(self, filename: str, content: str) -> None:
        self.__unix_newlines: bool = "\r" not in content
        self._content_slice: Slice = Slice(content.replace("\r\n", "\n"))
        self.__language: Language = Language.from_filename(filename)
        self.__escape_leading_whitespace = EscapeLeadingWhitespace.appropriate_for(
            self._content_slice.__str__()
        )

    def remove_selfie_once_comments(self):
        # Split content into lines
        lines = self._content_slice.__str__().split("\n")

        # Create a new list of lines, excluding lines containing '# selfieonce' or '#selfieonce'
        new_lines = []
        for line in lines:
            # Check for both variations of the comment
            if "# selfieonce" in line:
                cleaned_line = line.split("# selfieonce")[0].strip()
            elif "#selfieonce" in line:
                cleaned_line = line.split("#selfieonce")[0].strip()
            else:
                new_lines.append(line)
                continue

            # If the line has code before the comment, keep the code part
            if cleaned_line:
                new_lines.append(cleaned_line)

        # Recombine the lines into a single string
        new_content = "\n".join(new_lines)

        # Update the content slice with new content
        self._content_slice = Slice(new_content)

        if not self.__unix_newlines:
            self._content_slice = Slice(new_content.replace("\n", "\r\n"))

    @property
    def as_string(self) -> str:
        return (
            self._content_slice.__str__()
            if self.__unix_newlines
            else self._content_slice.__str__().replace("\n", "\r\n")
        )

    class ToBeLiteral:
        def __init__(
            self,
            parent: "SourceFile",
            dot_fun_open_paren: str,
            function_call_plus_arg: Slice,
            arg: Slice,
            language: Language,
            escape_leading_whitespace: EscapeLeadingWhitespace,
        ) -> None:
            self.__parent = parent
            self.__dot_fun_open_paren = dot_fun_open_paren
            self.__function_call_plus_arg = function_call_plus_arg
            self.__arg = arg
            self.__language = language
            self.__escape_leading_whitespace = escape_leading_whitespace

        def _get_function_call_plus_arg(self):
            return self.__function_call_plus_arg

        def _get_arg(self):
            return self.__arg

        def set_literal_and_get_newline_delta(self, literal_value: LiteralValue) -> int:
            encoded = literal_value.format.encode(
                literal_value.actual,
                self.__language,
                self.__escape_leading_whitespace,
            )
            if not isinstance(literal_value.format, LiteralRepr):
                # we don't roundtrip LiteralRepr because `eval` is dangerous
                round_tripped = literal_value.format.parse(encoded, self.__language)
                if round_tripped != literal_value.actual:
                    raise ValueError(
                        f"There is an error in {literal_value.format.__class__.__name__}, "
                        "the following value isn't round tripping.\n"
                        f"Please report this error and the data below at "
                        "https://github.com/diffplug/selfie/issues/new\n"
                        f"```\n"
                        f"ORIGINAL\n{literal_value.actual}\n"
                        f"ROUNDTRIPPED\n{round_tripped}\n"
                        f"ENCODED ORIGINAL\n{encoded}\n"
                        f"```\n"
                    )
            existing_newlines = self.__function_call_plus_arg.count("\n")
            new_newlines = encoded.count("\n")
            self.__parent._content_slice = Slice(  # noqa: SLF001
                self.__function_call_plus_arg.replaceSelfWith(
                    f"{self.__dot_fun_open_paren}{encoded})"
                )
            )

            return new_newlines - existing_newlines

        def parse_literal(self, literal_format: LiteralFormat) -> Any:
            return literal_format.parse(self.__arg.__str__(), self.__language)

    def find_on_line(self, to_find: str, line_one_indexed: int) -> Slice:
        line_content = self._content_slice.unixLine(line_one_indexed)
        idx = line_content.indexOf(to_find)
        if idx == -1:
            raise AssertionError(
                f"Expected to find `{to_find}` on line {line_one_indexed}, but there was only `{line_content}`"
            )
        return line_content.subSequence(idx, idx + len(to_find))

    def replace_on_line(self, line_one_indexed: int, find: str, replace: str) -> None:
        assert "\n" not in find
        assert "\n" not in replace

        found = self.find_on_line(find, line_one_indexed)
        self._content_slice = Slice(found.replaceSelfWith(replace))

    def parse_to_be_like(self, line_one_indexed: int) -> ToBeLiteral:
        line_content = self._content_slice.unixLine(line_one_indexed)
        dot_fun_open_paren = None

        for to_be_like in TO_BE_LIKES:
            idx = line_content.indexOf(to_be_like)
            if idx != -1:
                dot_fun_open_paren = to_be_like
                break
        if dot_fun_open_paren is None:
            raise AssertionError(
                f"Expected to find inline assertion on line {line_one_indexed}, but there was only `{line_content}`"
            )

        dot_function_call_in_place = line_content.indexOf(dot_fun_open_paren)
        dot_function_call = dot_function_call_in_place + line_content.startIndex
        arg_start = dot_function_call + len(dot_fun_open_paren)

        if self._content_slice.__len__() == arg_start:
            raise AssertionError(
                f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                f"on line {line_one_indexed}"
            )
        while self._content_slice[arg_start].isspace():
            arg_start += 1
            if self._content_slice.__len__() == arg_start:
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                    f"on line {line_one_indexed}"
                )

        if self._content_slice[arg_start] == '"':
            (end_paren, end_arg) = self._parse_string(
                line_one_indexed, arg_start, dot_fun_open_paren
            )
        else:
            (end_paren, end_arg) = self._parse_code(
                line_one_indexed, arg_start, dot_fun_open_paren
            )
        return self.ToBeLiteral(
            self,
            dot_fun_open_paren.replace("_TODO", ""),
            self._content_slice.subSequence(dot_function_call, end_paren + 1),
            self._content_slice.subSequence(arg_start, end_arg),
            self.__language,
            self.__escape_leading_whitespace,
        )

    def _parse_code(
        self,
        line_one_indexed: int,
        arg_start: int,
        dot_fun_open_paren: str,
    ):
        # Initialize variables
        parenthesis_count = 1
        string_delimiter = None

        # Iterate through the characters starting from the given index
        for i in range(arg_start, len(self._content_slice)):
            char = self._content_slice[i]

            # Check if we are entering or leaving a string
            if char in ["'", '"'] and self._content_slice[i - 1] != "\\":
                if not string_delimiter:
                    string_delimiter = char
                elif char == string_delimiter:
                    string_delimiter = None

            # Skip characters inside strings
            if string_delimiter:
                continue

            # Count parentheses
            if char == "(":
                parenthesis_count += 1
            elif char == ")":
                parenthesis_count -= 1

            # If all parentheses are closed, return the current index
            if parenthesis_count == 0:
                end_paren = i
                end_arg = i
                return (end_paren, end_arg)
        # else ...
        raise AssertionError(
            f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
            f"starting at line {line_one_indexed}"
        )

    def _parse_string(
        self,
        line_one_indexed: int,
        arg_start: int,
        dot_fun_open_paren: str,
    ):
        if self._content_slice.subSequence(
            arg_start, len(self._content_slice)
        ).starts_with(self.TRIPLE_QUOTE):
            end_arg = self._content_slice.indexOf(
                self.TRIPLE_QUOTE, arg_start + len(self.TRIPLE_QUOTE)
            )
            if end_arg == -1:
                raise AssertionError(
                    f"Appears to be an unclosed multiline string literal `{self.TRIPLE_QUOTE}` "
                    f"on line {line_one_indexed}"
                )
            else:
                end_arg += len(self.TRIPLE_QUOTE)
                end_paren = end_arg
        else:
            end_arg = arg_start + 1
            while (
                self._content_slice[end_arg] != '"'
                or self._content_slice[end_arg - 1] == "\\"
            ):
                end_arg += 1
                if end_arg == self._content_slice.__len__():
                    raise AssertionError(
                        f'Appears to be an unclosed string literal `"` '
                        f"on line {line_one_indexed}"
                    )
            end_arg += 1
            end_paren = end_arg
        while self._content_slice[end_paren] != ")":
            if not self._content_slice[end_paren].isspace():
                raise AssertionError(
                    f"Non-primitive literal in `{dot_fun_open_paren}` starting at "
                    f"line {line_one_indexed}: error for character "
                    f"`{self._content_slice[end_paren]}` on line "
                    f"{self._content_slice.baseLineAtOffset(end_paren)}"
                )
            end_paren += 1
            if end_paren == self._content_slice.__len__():
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                    f"starting at line {line_one_indexed}"
                )
        return (end_paren, end_arg)


TO_BE_LIKES = [
    ".to_be(",
    ".to_be_TODO(",
    ".to_be_base64(",
    ".to_be_base64_TODO(",
    ".to_be_TODO(",
]
