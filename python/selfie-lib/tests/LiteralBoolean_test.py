def _encode(value: bool, expected: str):
    actual = "true" if value else "false"
    assert actual == expected, f"Expected: {expected}, Got: {actual}"


def _decode(value: str, expected: bool):
    actual = value.lower() == "true"
    assert actual == expected, f"Expected: {expected}, Got: {actual}"


class TestLiteralBoolean:
    def test_encode(self):
        _encode(True, "true")
        _encode(False, "false")

    def test_decode(self):
        _decode("true", True)
        _decode("false", False)
