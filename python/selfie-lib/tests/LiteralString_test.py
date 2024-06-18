import pytest

from selfie_lib.EscapeLeadingWhitespace import EscapeLeadingWhitespace
from selfie_lib.Literals import LiteralString


class TestLiteralString:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [("1", '"1"'), ("\\", '"\\\\"'), ("1\n\tABC", '"1\\n\\tABC"')],
    )
    def test_encode_single(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string._encodeSinglePython(value)  # noqa: SLF001
        assert actual == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [("1", "`1`"), ("\\", "`\\\\`"), ("1\n\tABC", "`1\\n\\tABC`")],
    )
    def test_encode_single_with_dollars(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string._encodeSinglePython(value)  # noqa: SLF001
        assert actual == expected.replace("`", '"')

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("1", "'''1'''"),
            ("\\", "'''\\\\'''"),
            (
                "  leading\ntrailing  ",
                "'''  leading\ntrailing \\u0020'''",
            ),
        ],
    )
    def test_encode_multi(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string.encodeMultiPython(value, EscapeLeadingWhitespace.NEVER)
        assert actual == expected.replace("'", '"')

    @pytest.mark.parametrize(
        ("value", "expected"), [("1", "1"), ("\\\\", "\\"), ("1\\n\\tABC", "1\n\tABC")]
    )
    def test_parse_single(self, value, expected):
        literal_string = LiteralString()
        replaced = value.replace("'", '"')
        actual = literal_string._parseSinglePython(f'"{replaced}"')  # noqa: SLF001
        assert actual == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("\n123\nabc", "\n123\nabc"),
            ("\n  123\n  abc", "\n  123\n  abc"),
            ("\n  123  \n  abc\t", "\n  123  \n  abc\t"),
            ("  123  \n  abc\t", "  123  \n  abc\t"),
        ],
    )
    def test_parse_multi(self, value, expected):
        literal_string = LiteralString()
        replaced = value.replace("'", '"')
        actual = literal_string.parseMultiPython(f'"""{replaced}"""')
        assert actual == expected
