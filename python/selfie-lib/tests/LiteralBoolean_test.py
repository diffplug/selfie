from selfie_lib.Literals import LiteralBoolean, Language
from selfie_lib.EscapeLeadingWhitespace import EscapeLeadingWhitespace


def _encode(value: bool, expected: str):
    literal_boolean = LiteralBoolean()
    actual = literal_boolean.encode(
        value, Language.PYTHON, EscapeLeadingWhitespace.NEVER
    )
    assert actual == expected, f"Expected: {expected}, Got: {actual}"


def _decode(value: str, expected: bool):
    literal_boolean = LiteralBoolean()
    actual = literal_boolean.parse(value, Language.PYTHON)
    assert actual == expected, f"Expected: {expected}, Got: {actual}"


class TestLiteralBoolean:
    def test_encode(self):
        _encode(True, "True")
        _encode(False, "False")

    def test_decode(self):
        _decode("true", True)
        _decode("false", False)
