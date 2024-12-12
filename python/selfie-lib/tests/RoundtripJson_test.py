from selfie_lib.RoundtripJson import RoundtripJson


def test_roundtrip_json_simple():
    roundtrip = RoundtripJson.of()
    value = {"key": "value", "number": 42}
    json_str = roundtrip.to_string(value)
    assert roundtrip.from_string(json_str) == value


def test_roundtrip_json_nested():
    roundtrip = RoundtripJson.of()
    value = {"nested": {"array": [1, 2, 3], "object": {"key": "value"}}}
    json_str = roundtrip.to_string(value)
    assert roundtrip.from_string(json_str) == value


def test_roundtrip_json_special_chars():
    roundtrip = RoundtripJson.of()
    value = {"special": 'line\nbreak\ttab"quote\\backslash', "unicode": "🐍Python"}
    json_str = roundtrip.to_string(value)
    assert roundtrip.from_string(json_str) == value
