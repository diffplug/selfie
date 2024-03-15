from selfie_lib.Literals import LiteralInt, Language
from selfie_lib.EscapeLeadingWhitespace import EscapeLeadingWhitespace


def _encode(value: int, expected: str):
    literal_int = LiteralInt()
    actual = literal_int.encode(value, Language.PYTHON, EscapeLeadingWhitespace.NEVER)
    assert actual == expected, f"Expected '{expected}', but got '{actual}'"


def _decode(value: str, expected: int):
    literal_int = LiteralInt()
    actual = literal_int.parse(value, Language.PYTHON)
    assert actual == expected, f"Expected '{expected}', but got '{actual}'"


class TestLiteralInt:
    def test_encode(self):
        test_cases = [
            (0, "0"),
            (1, "1"),
            (-1, "-1"),
            (999, "999"),
            (-999, "-999"),
            (1_000, "1_000"),
            (-1_000, "-1_000"),
            (1_000_000, "1_000_000"),
            (-1_000_000, "-1_000_000"),
            (2400500, "2_400_500"),
            (2400501, "2_400_501"),
            (200, "200"),
            (1001, "1_001"),
            (1010, "1_010"),
            (10010, "10_010"),
        ]
        for value, expected in test_cases:
            _encode(value, expected)

    def test_decode(self):
        test_cases = [
            ("0", 0),
            ("1", 1),
            ("-1", -1),
            ("999", 999),
            ("9_99", 999),
            ("9_9_9", 999),
            ("-999", -999),
            ("-9_99", -999),
            ("-9_9_9", -999),
        ]
        for value, expected in test_cases:
            _decode(value, expected)
