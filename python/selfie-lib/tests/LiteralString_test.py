import pytest
from selfie_lib.Literals import LiteralString
from selfie_lib.EscapeLeadingWhitespace import EscapeLeadingWhitespace


class TestLiteralString:
    @pytest.mark.parametrize(
        "value, expected",
        [("1", '"1"'), ("\\", '"\\\\"'), ("1\n\tABC", '"1\\n\\tABC"')],
    )
    def test_encode_single(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string._encodeSinglePython(value)
        print(actual)
        assert actual == expected

    @pytest.mark.parametrize(
        "value, expected",
        [("1", "`1`"), ("\\", "`\\\\`"), ("1\n\tABC", "`1\\n\\tABC`")],
    )
    def test_encode_single_with_dollars(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string._encodeSinglePython(value)
        assert actual == expected.replace("`", '"')

    @pytest.mark.parametrize(
        "value, expected",
        [
            ("1", "'''\n1'''"),
            ("\\", "'''\n\\\\'''"),
            (
                "  leading\ntrailing  ",
                "'''\n" + "  leading\n" + "trailing \\u0020'''",
            ),
        ],
    )
    def test_encode_multi(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string.encodeMultiPython(value, EscapeLeadingWhitespace.NEVER)
        assert actual == expected.replace("'", '"')

    @pytest.mark.parametrize(
        "value, expected", [("1", "1"), ("\\\\", "\\"), ("1\\n\\tABC", "1\n\tABC")]
    )
    def test_parse_single(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string._parseSinglePython(f'"{value.replace("'", "\"")}"')
        assert actual == expected

    @pytest.mark.parametrize(
        "value, expected",
        [
            ("\n123\nabc", "123\nabc"),
            ("\n  123\n  abc", "123\nabc"),
            ("\n  123  \n  abc\t", "123\nabc"),
            ("\n  123  \n  abc\t", "123\nabc"),
            ("\n  123  \\s\n  abc\t\\s", "123   \nabc\t "),
        ],
    )
    def test_parse_multi(self, value, expected):
        literal_string = LiteralString()
        actual = literal_string.parseMultiPython(f'"""{value.replace("'", "\"")}"""')
        assert actual == expected
