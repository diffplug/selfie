from .Slice import Slice
from .Literals import Language
from .EscapeLeadingWhitespace import EscapeLeadingWhitespace
from typing import Any


class SourceFile:
    TRIPLE_QUOTE = '"""'

    def __init__(self, filename: str, content: str) -> None:
        self.unix_newlines = "\r" not in content
        self.content_slice = Slice(content).__str__().replace("\r\n", "\n")
        self.language = Language.from_filename(filename)
        self.escape_leading_whitespace = EscapeLeadingWhitespace.appropriate_for(
            self.content_slice.__str__()
        )

    @property
    def as_string(self) -> str:
        return (
            self.content_slice.__str__()
            if self.unix_newlines
            else self.content_slice.__str__().replace("\n", "\r\n")
        )

    class ToBeLiteral:
        def __init__(
            self, dot_fun_open_paren: str, function_call_plus_arg: Slice, arg: Slice
        ) -> None:
            self.dot_fun_open_paren = dot_fun_open_paren
            self.function_call_plus_arg = function_call_plus_arg
            self.arg = arg
            self.language = Language
            self.escape_leading_whitespace = EscapeLeadingWhitespace

        def set_literal_and_get_newline_delta(self, literal_value: LiteralValue) -> int:
            encoded = literal_value.format.encode(
                literal_value.actual, self.language, self.escape_leading_whitespace
            )
            round_tripped = literal_value.format.parse(encoded, self.language)
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
            existing_newlines = self.function_call_plus_arg.count("\n")
            new_newlines = encoded.count("\n")
            self.content_slice = self.function_call_plus_arg.replaceSelfWith(
                f"{self.dot_fun_open_paren}{encoded})"
            )
            return new_newlines - existing_newlines

        def parse_literal(self, literal_format: LiteralFormat) -> Any:
            return literal_format.parse(self.arg.__str__(), self.language)

    def remove_selfie_once_comments(self) -> None:
        self.content_slice = self.content_slice.replace("//selfieonce", "").replace(
            "// selfieonce", ""
        )

    def find_on_line(self, to_find: str, line_one_indexed: int) -> Slice:
        line_content = self.content_slice.unixLine(line_one_indexed)
        idx = line_content.find(to_find)
        if idx == -1:
            raise AssertionError(
                f"Expected to find `{to_find}` on line {line_one_indexed}, "
                f"but there was only `{line_content}`"
            )
        return line_content[idx : idx + len(to_find)]

    def replace_on_line(self, line_one_indexed: int, find: str, replace: str) -> None:
        assert "\n" not in find
        assert "\n" not in replace
        slice_ = self.find_on_line(find, line_one_indexed)
        self.content_slice = slice_.replaceSelfWith(replace)

    def parse_to_be_like(self, line_one_indexed: int) -> ToBeLiteral:
        line_content = self.content_slice.unixLine(line_one_indexed)
        dot_fun_open_paren = min(
            (line_content.find(t) for t in TO_BE_LIKES if t in line_content),
            key=lambda x: x[0] if x[0] != -1 else float("inf"),
        )
        dot_fun_open_paren = (
            dot_fun_open_paren[1] if dot_fun_open_paren[0] != -1 else None
        )
        if dot_fun_open_paren is None:
            raise AssertionError(
                f"Expected to find inline assertion on line {line_one_indexed}, "
                f"but there was only `{line_content}`"
            )
        dot_function_call_in_place = line_content.find(dot_fun_open_paren)
        dot_function_call = dot_function_call_in_place + line_content.start_index
        arg_start = dot_function_call + len(dot_fun_open_paren)
        if self.content_slice.__len__ == arg_start:
            raise AssertionError(
                f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                f"on line {line_one_indexed}"
            )
        while self.content_slice[arg_start].isspace():
            arg_start += 1
            if self.content_slice.__len__ == arg_start:
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                    f"on line {line_one_indexed}"
                )

        end_arg = -1
        end_paren = 0
        if self.content_slice[arg_start] == '"':
            if self.content_slice[arg_start:].startswith(self.TRIPLE_QUOTE):
                end_arg = self.content_slice.find(
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
                    self.content_slice[end_arg] != '"'
                    or self.content_slice[end_arg - 1] == "\\"
                ):
                    end_arg += 1
                    if end_arg == self.content_slice.__len__:
                        raise AssertionError(
                            f'Appears to be an unclosed string literal `"` '
                            f"on line {line_one_indexed}"
                        )
                end_arg += 1
                end_paren = end_arg
        else:
            end_arg = arg_start
            while not self.content_slice[end_arg].isspace():
                if self.content_slice[end_arg] == ")":
                    break
                end_arg += 1
                if end_arg == self.content_slice.__len__:
                    raise AssertionError(
                        f"Appears to be an unclosed numeric literal "
                        f"on line {line_one_indexed}"
                    )
            end_paren = end_arg
        while self.content_slice[end_paren] != ")":
            if not self.content_slice[end_paren].isspace():
                raise AssertionError(
                    f"Non-primitive literal in `{dot_fun_open_paren}` starting at "
                    f"line {line_one_indexed}: error for character "
                    f"`{self.content_slice[end_paren]}` on line "
                    f"{self.content_slice.baseLineAtOffset(end_paren)}"
                )
            end_paren += 1
            if end_paren == self.content_slice.__len__:
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren}` "
                    f"starting at line {line_one_indexed}"
                )
        return self.ToBeLiteral(
            dot_fun_open_paren.replace("_TODO", ""),
            self.content_slice.subSequence(dot_function_call, end_paren + 1),
            self.content_slice.subSequence(arg_start, end_arg),
        )


TO_BE_LIKES = [".toBe(", ".toBe_TODO(", ".toBeBase64(", ".toBeBase64_TODO("]
