from .Slice import Slice
from .Literals import Language, LiteralFormat, LiteralValue
from .EscapeLeadingWhitespace import EscapeLeadingWhitespace
from typing import Any


class SourceFile:
    TRIPLE_QUOTE = '"""'

    def __init__(self, filename: str, content: str) -> None:
        self.__unix_newlines: bool = "\r" not in content
        self.__content_slice: Slice = Slice(content.replace("\r\n", "\n"))
        self.__language: Language = Language.from_filename(filename)
        self.__escape_leading_whitespace = EscapeLeadingWhitespace.appropriate_for(
            self.__content_slice.__str__()
        )

    @property
    def as_string(self) -> str:
        return (
            self.__content_slice.__str__()
            if self.__unix_newlines
            else self.__content_slice.__str__().replace("\n", "\r\n")
        )

    class ToBeLiteral:
        def __init__(
            self,
            dot_fun_open_paren: str,
            function_call_plus_arg: Slice,
            arg: Slice,
            language: Language,
            escape_leading_whitespace: EscapeLeadingWhitespace,
        ) -> None:
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
                literal_value.actual, self.__language, self.__escape_leading_whitespace
            )
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
            self.__content_slice = self.__function_call_plus_arg.replaceSelfWith(
                f"{self.__dot_fun_open_paren}{encoded})"
            )
            return new_newlines - existing_newlines

        def parse_literal(self, literal_format: LiteralFormat) -> Any:
            return literal_format.parse(self.__arg.__str__(), self.__language)

    def find_on_line(self, to_find: str, line_one_indexed: int) -> Slice:
        line_content = self.__content_slice.unixLine(line_one_indexed)
        idx = line_content.indexOf(to_find)
        if idx == -1:
            raise AssertionError(
                f"Expected to find `{to_find}` on line {line_one_indexed}, "
                f"but there was only `{line_content}`"
            )
        start_index = idx
        end_index = idx + len(to_find)
        return line_content.subSequence(start_index, end_index)

    def replace_on_line(self, line_one_indexed: int, find: str, replace: str) -> None:
        assert "\n" not in find
        assert "\n" not in replace
        line_content = self.__content_slice.unixLine(line_one_indexed).__str__()
        new_content = line_content.replace(find, replace)
        self.__content_slice = Slice(self.__content_slice.replaceSelfWith(new_content))

    def parse_to_be_like(self, line_one_indexed: int) -> ToBeLiteral:
        line_content = self.__content_slice.unixLine(line_one_indexed)
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

        if self.__content_slice.__len__() == arg_start:
            raise AssertionError(
                f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                f"on line {line_one_indexed}"
            )
        while self.__content_slice[arg_start].isspace():
            arg_start += 1
            if self.__content_slice.__len__() == arg_start:
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                    f"on line {line_one_indexed}"
                )

        end_arg = -1
        end_paren = 0
        if self.__content_slice[arg_start] == '"':
            if self.__content_slice[arg_start].startswith(self.TRIPLE_QUOTE):
                end_arg = self.__content_slice.indexOf(
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
                    self.__content_slice[end_arg] != '"'
                    or self.__content_slice[end_arg - 1] == "\\"
                ):
                    end_arg += 1
                    if end_arg == self.__content_slice.__len__():
                        raise AssertionError(
                            f'Appears to be an unclosed string literal `"` '
                            f"on line {line_one_indexed}"
                        )
                end_arg += 1
                end_paren = end_arg
        else:
            end_arg = arg_start
            while not self.__content_slice[end_arg].isspace():
                if self.__content_slice[end_arg] == ")":
                    break
                end_arg += 1
                if end_arg == self.__content_slice.__len__():
                    raise AssertionError(
                        f"Appears to be an unclosed numeric literal "
                        f"on line {line_one_indexed}"
                    )
            end_paren = end_arg
        while self.__content_slice[end_paren] != ")":
            if not self.__content_slice[end_paren].isspace():
                raise AssertionError(
                    f"Non-primitive literal in `{dot_fun_open_paren}` starting at "
                    f"line {line_one_indexed}: error for character "
                    f"`{self.__content_slice[end_paren]}` on line "
                    f"{self.__content_slice.baseLineAtOffset(end_paren)}"
                )
            end_paren += 1
            if end_paren == self.__content_slice.__len__():
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                    f"starting at line {line_one_indexed}"
                )
        return self.ToBeLiteral(
            dot_fun_open_paren.replace("_TODO", ""),
            self.__content_slice.subSequence(dot_function_call, end_paren + 1),
            self.__content_slice.subSequence(arg_start, end_arg),
            self.__language,
            self.__escape_leading_whitespace,
        )


TO_BE_LIKES = [".toBe(", ".toBe_TODO(", ".toBeBase64(", ".toBeBase64_TODO("]
