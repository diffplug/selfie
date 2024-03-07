import pytest

from selfie_lib import PerCharacterEscaper


class TestPerCharacterEscaper:
    def test_performance_optimization_self(self):
        escaper = PerCharacterEscaper.self_escape("`123")
        abc = "abc"
        # Using 'is' to check for the exact same object might not behave as in Kotlin, use == for equality in Python
        assert escaper.escape(abc) == abc
        assert escaper.unescape(abc) == abc

        assert escaper.escape("1") == "`1"
        assert escaper.escape("`") == "``"
        assert escaper.escape("abc123`def") == "abc`1`2`3``def"

        assert escaper.unescape("`1") == "1"
        assert escaper.unescape("``") == "`"
        assert escaper.unescape("abc`1`2`3``def") == "abc123`def"

    def test_performance_optimization_specific(self):
        escaper = PerCharacterEscaper.specified_escape("`a1b2c3d")
        abc = "abc"
        assert escaper.escape(abc) == abc
        assert escaper.unescape(abc) == abc

        assert escaper.escape("1") == "`b"
        assert escaper.escape("`") == "`a"
        assert escaper.escape("abc123`def") == "abc`b`c`d`adef"

        assert escaper.unescape("`b") == "1"
        assert escaper.unescape("`a") == "`"
        assert escaper.unescape("abc`1`2`3``def") == "abc123`def"

    def test_corner_cases_self(self):
        escaper = PerCharacterEscaper.self_escape("`123")
        with pytest.raises(ValueError) as excinfo:
            escaper.unescape("`")
        assert (
            str(excinfo.value)
            == "Escape character '`' can't be the last character in a string."
        )
        assert escaper.unescape("`a") == "a"

    def test_corner_cases_specific(self):
        escaper = PerCharacterEscaper.specified_escape("`a1b2c3d")
        with pytest.raises(ValueError) as excinfo:
            escaper.unescape("`")
        assert (
            str(excinfo.value)
            == "Escape character '`' can't be the last character in a string."
        )
        assert escaper.unescape("`e") == "e"

    def test_roundtrip(self):
        escaper = PerCharacterEscaper.self_escape("`<>")

        def roundtrip(str):
            assert escaper.unescape(escaper.escape(str)) == str

        roundtrip("")
        roundtrip("<local>~`/")
