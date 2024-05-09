import io

from selfie_lib.Literals import _encode_int_underscores


def _encode(value: int, expected: str):
    actual = _encode_int_underscores(io.StringIO(), value)
    assert actual == expected


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
