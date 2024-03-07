from Literals import Language
from EscapeLeadingWhitespace import EscapeLeadingWhitespace


class SourceFile:
    TRIPLE_QUOTE = '"""'

    def __init__(self, filename, content):
        self.unix_newlines = "\r" not in content
        self.content_slice = content.replace("\r\n", "\n")
        self.language = Language.from_filename(filename)
        self.escape_leading_whitespace = EscapeLeadingWhitespace.appropriate_for(
            self.content_slice
        )

    @property
    def as_string(self):
        return (
            self.content_slice
            if self.unix_newlines
            else self.content_slice.replace("\n", "\r\n")
        )

    class ToBeLiteral:
        def __init__(self, dot_fun_open_paren, function_call_plus_arg, arg):
            self.dot_fun_open_paren = dot_fun_open_paren
            self.function_call_plus_arg = function_call_plus_arg
            self.arg = arg
            self.language = Language
            self.escape_leading_whitespace = EscapeLeadingWhitespace

        def set_literal_and_get_newline_delta(self, literal_value):
            encoded = literal_value.format.encode(
                literal_value.actual, self.language, self.escape_leading_whitespace
            )
            round_tripped = literal_value.format.parse(encoded, self.language)
            if round_tripped != literal_value.actual:
                raise ValueError(
                    f"There is an error in {literal_value.format}, "
                    f"the following value isn't round tripping:\n"
                    f"ORIGINAL\n{literal_value.actual}\n"
                    f"ROUNDTRIPPED\n{round_tripped}\n"
                    f"ENCODED ORIGINAL\n{encoded}\n"
                )

            existing_newlines = self.function_call_plus_arg.count("\n")
            new_newlines = encoded.count("\n")
            self.content_slice = self.function_call_plus_arg.replace(
                f"{self.dot_fun_open_paren}{encoded})"
            )
            return new_newlines - existing_newlines

        def parse_literal(self, literal_format):
            return literal_format.parse(self.arg, self.language)

    def remove_selfie_once_comments(self):
        self.content_slice = self.content_slice.replace("//selfieonce", "").replace(
            "// selfieonce", ""
        )

    def find_on_line(self, to_find, line_one_indexed):
        line_content = self.content_slice.splitlines()[line_one_indexed - 1]
        idx = line_content.find(to_find)
        if idx == -1:
            raise AssertionError(
                f"Expected to find `{to_find}` on line {line_one_indexed}, "
                f"but there was only `{line_content}`"
            )
        return line_content[idx : idx + len(to_find)]

    def replace_on_line(self, line_one_indexed, find, replace):
        self.content_slice = self.content_slice.replace(find, replace)

    def parse_to_be_like(self, line_one_indexed):
        line_content = self.content_slice.splitlines()[line_one_indexed - 1]
        dot_fun_open_paren = min(
            (it for it in TO_BE_LIKES if it in line_content), key=line_content.find
        )
        dot_function_call_in_place = line_content.find(dot_fun_open_paren)
        dot_function_call = dot_function_call_in_place + line_content.start
        arg_start = dot_function_call + len(dot_fun_open_paren)
        if len(self.content_slice) == arg_start:
            raise AssertionError(
                f"Appears to be an unclosed function call `{dot_fun_open_paren})` on line {line_one_indexed}"
            )

        while self.content_slice[arg_start].isspace():
            arg_start += 1
            if len(self.content_slice) == arg_start:
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren})` on line {line_one_indexed}"
                )

        end_arg = -1
        end_paren = -1
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
                    if end_arg == len(self.content_slice):
                        raise AssertionError(
                            f'Appears to be an unclosed string literal `"` on line {line_one_indexed}'
                        )
                end_arg += 1
                end_paren = end_arg
        else:
            end_arg = arg_start
            while not self.content_slice[end_arg].isspace():
                if self.content_slice[end_arg] == ")":
                    break
                end_arg += 1
                if end_arg == len(self.content_slice):
                    raise AssertionError(
                        f"Appears to be an unclosed numeric literal on line {line_one_indexed}"
                    )
            end_paren = end_arg

        while self.content_slice[end_paren] != ")":
            if not self.content_slice[end_paren].isspace():
                raise AssertionError(
                    f"Non-primitive literal in `{dot_fun_open_paren})` starting at line {line_one_indexed}: "
                    f"error for character `{self.content_slice[end_paren]}` "
                    f"on line {self.content_slice.base_line_at_offset(end_paren)}"
                )
            end_paren += 1
            if end_paren == len(self.content_slice):
                raise AssertionError(
                    f"Appears to be an unclosed function call `{dot_fun_open_paren})` "
                    f"starting at line {line_one_indexed}"
                )

        return self.ToBeLiteral(
            dot_fun_open_paren.replace("_TODO", ""),
            self.content_slice[dot_function_call : end_paren + 1],
            self.content_slice[arg_start:end_arg],
        )


TO_BE_LIKES = [".toBe(", ".toBe_TODO(", ".toBeBase64(", ".toBeBase64_TODO("]
