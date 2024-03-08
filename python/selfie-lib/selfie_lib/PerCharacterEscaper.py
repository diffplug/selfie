from typing import List


class PerCharacterEscaper:
    def __init__(
        self,
        escape_code_point: int,
        escaped_code_points: List[int],
        escaped_by_code_points: List[int],
    ):
        self.__escape_code_point = escape_code_point
        self.__escaped_code_points = escaped_code_points
        self.__escaped_by_code_points = escaped_by_code_points

    def __first_offset_needing_escape(self, input_string: str) -> int:
        length = len(input_string)
        for offset in range(length):
            codepoint = ord(input_string[offset])
            if (
                codepoint == self.__escape_code_point
                or codepoint in self.__escaped_code_points
            ):
                return offset
        return -1

    def escape(self, input_string: str) -> str:
        no_escapes = self.__first_offset_needing_escape(input_string)
        if no_escapes == -1:
            return input_string
        else:
            result = []
            result.append(input_string[:no_escapes])
            for char in input_string[no_escapes:]:
                codepoint = ord(char)
                if codepoint in self.__escaped_code_points:
                    idx = self.__escaped_code_points.index(codepoint)
                    result.append(chr(self.__escape_code_point))
                    result.append(chr(self.__escaped_by_code_points[idx]))
                else:
                    result.append(char)
            return "".join(result)

    def unescape(self, input_string: str) -> str:
        if not input_string:
            return input_string

        result = []
        i = 0

        while i < len(input_string):
            if ord(input_string[i]) == self.__escape_code_point:
                if i + 1 < len(input_string):
                    next_char = input_string[i + 1]
                    next_codepoint = ord(next_char)

                    if next_codepoint == self.__escape_code_point:
                        result.append(chr(next_codepoint))
                        i += 2
                    else:
                        try:
                            idx = self.__escaped_by_code_points.index(next_codepoint)
                            result.append(chr(self.__escaped_code_points[idx]))
                            i += 2
                            continue
                        except ValueError:
                            result.append(next_char)
                            i += 2
                else:
                    raise ValueError(
                        f"Escape character '{chr(self.__escape_code_point)}' can't be the last character in a string."
                    )
            else:
                result.append(input_string[i])
                i += 1

        processed_string = "".join(result)
        if processed_string == input_string:
            return input_string
        else:
            return processed_string

    @classmethod
    def self_escape(cls, escape_policy):
        code_points = [ord(c) for c in escape_policy]
        escape_code_point = code_points[0]
        return cls(escape_code_point, code_points, code_points)

    @classmethod
    def specified_escape(cls, escape_policy):
        code_points = [ord(c) for c in escape_policy]
        if len(code_points) % 2 != 0:
            raise ValueError(
                "Escape policy string must have an even number of characters."
            )
        escape_code_point = code_points[0]
        escaped_code_points = code_points[0::2]
        escaped_by_code_points = code_points[1::2]
        return cls(escape_code_point, escaped_code_points, escaped_by_code_points)
