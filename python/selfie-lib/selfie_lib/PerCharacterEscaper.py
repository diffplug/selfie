from typing import List


class PerCharacterEscaper:
    def __init__(
        self,
        escape_code_point: int,
        escaped_code_points: List[int],
        escaped_by_code_points: List[int],
    ):
        self.__escape_code_point: int = escape_code_point
        self.__escaped_code_points: List[int] = escaped_code_points
        self.__escaped_by_code_points: List[int] = escaped_by_code_points

    def __first_offset_needing_escape(self, input_string: str) -> int:
        length: int = len(input_string)
        for offset in range(length):
            codepoint: int = ord(input_string[offset])
            if (
                codepoint == self.__escape_code_point
                or codepoint in self.__escaped_code_points
            ):
                return offset
        return -1

    def escape(self, input_string: str) -> str:
        no_escapes: int = self.__first_offset_needing_escape(input_string)
        if no_escapes == -1:
            return input_string
        else:
            result: List[str] = []
            result.append(input_string[:no_escapes])
            for char in input_string[no_escapes:]:
                codepoint: int = ord(char)
                if codepoint in self.__escaped_code_points:
                    idx: int = self.__escaped_code_points.index(codepoint)
                    result.append(chr(self.__escape_code_point))
                    result.append(chr(self.__escaped_by_code_points[idx]))
                else:
                    result.append(char)
            return "".join(result)

    def unescape(self, input_string: str) -> str:
        if input_string.endswith(
            chr(self.__escape_code_point)
        ) and not input_string.endswith(chr(self.__escape_code_point) * 2):
            raise ValueError(
                "Escape character '{}' can't be the last character in a string.".format(
                    chr(self.__escape_code_point)
                )
            )

        no_escapes: int = self.__first_offset_needing_escape(input_string)
        if no_escapes == -1:
            return input_string
        else:
            result: List[str] = [input_string[:no_escapes]]
            skip_next: bool = False
            for i in range(no_escapes, len(input_string)):
                if skip_next:
                    skip_next = False
                    continue
                codepoint: int = ord(input_string[i])
                if codepoint == self.__escape_code_point and (i + 1) < len(
                    input_string
                ):
                    next_codepoint: int = ord(input_string[i + 1])
                    if next_codepoint in self.__escaped_by_code_points:
                        idx: int = self.__escaped_by_code_points.index(next_codepoint)
                        result.append(chr(self.__escaped_code_points[idx]))
                        skip_next = True
                    else:
                        result.append(input_string[i + 1])
                        skip_next = True
                else:
                    result.append(chr(codepoint))
            return "".join(result)

    @classmethod
    def self_escape(cls, escape_policy: str) -> "PerCharacterEscaper":
        code_points: List[int] = [ord(c) for c in escape_policy]
        escape_code_point: int = code_points[0]
        return cls(escape_code_point, code_points, code_points)

    @classmethod
    def specified_escape(cls, escape_policy: str) -> "PerCharacterEscaper":
        code_points: List[int] = [ord(c) for c in escape_policy]
        if len(code_points) % 2 != 0:
            raise ValueError(
                "Escape policy string must have an even number of characters."
            )
        escape_code_point: int = code_points[0]
        escaped_code_points: List[int] = code_points[0::2]
        escaped_by_code_points: List[int] = code_points[1::2]
        return cls(escape_code_point, escaped_code_points, escaped_by_code_points)
