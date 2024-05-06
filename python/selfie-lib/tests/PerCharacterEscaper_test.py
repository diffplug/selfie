import pytest

from selfie_lib import PerCharacterEscaper


class TestPerCharacterEscaper:
    def test_performance_optimization_self(self):
        escaper = PerCharacterEscaper.self_escape("`123")
        abc = "abc"
        # Correct use of 'is' for checking object identity.
        assert (
            escaper.escape(abc) is abc
        ), "Escape should return the original object when no change is made"
        assert (
            escaper.unescape(abc) is abc
        ), "Unescape should return the original object when no change is made"

        # Use '==' for checking value equality.
        assert (
            escaper.escape("1") == "`1"
        ), "Escaping '1' should prepend the escape character"
        assert (
            escaper.escape("`") == "``"
        ), "Escaping the escape character should duplicate it"
        assert (
            escaper.escape("abc123`def") == "abc`1`2`3``def"
        ), "Escaping 'abc123`def' did not produce the expected result"

        assert escaper.unescape("`1") == "1", "Unescaping '`1' should produce '1'"
        assert escaper.unescape("``") == "`", "Unescaping '``' should produce '`'"
        assert (
            escaper.unescape("abc`1`2`3``def") == "abc123`def"
        ), "Unescaping 'abc`1`2`3``def' did not produce the expected result"

    def test_performance_optimization_specific(self):
        escaper = PerCharacterEscaper.specified_escape("`a1b2c3d")
        abc = "abc"
        # Correct use of 'is' for object identity.
        assert (
            escaper.escape(abc) is abc
        ), "Escape should return the original object when no change is made"
        assert (
            escaper.unescape(abc) is abc
        ), "Unescape should return the original object when no change is made"

        # Use '==' for value equality.
        assert escaper.escape("1") == "`b", "Escaping '1' should produce '`b'"
        assert escaper.escape("`") == "`a", "Escaping '`' should produce '`a'"
        assert (
            escaper.escape("abc123`def") == "abc`b`c`d`adef"
        ), "Escaping 'abc123`def' did not produce the expected result"

        assert escaper.unescape("`b") == "1", "Unescaping '`b' should produce '1'"
        assert escaper.unescape("`a") == "`", "Unescaping '`a' should produce '`'"
        assert (
            escaper.unescape("abc`1`2`3``def") == "abc123`def"
        ), "Unescaping 'abc`1`2`3``def' did not produce the expected result"

    def test_corner_cases_self(self):
        escaper = PerCharacterEscaper.self_escape("`123")
        with pytest.raises(ValueError) as excinfo:
            escaper.unescape("`")
        assert (
            str(excinfo.value)
            == "Escape character '`' can't be the last character in a string."
        ), "Unescaping a string ending with a single escape character should raise ValueError"
        assert escaper.unescape("`a") == "a", "Unescaping '`a' should produce 'a'"

    def test_corner_cases_specific(self):
        escaper = PerCharacterEscaper.specified_escape("`a1b2c3d")
        with pytest.raises(ValueError) as excinfo:
            escaper.unescape("`")
        assert (
            str(excinfo.value)
            == "Escape character '`' can't be the last character in a string."
        ), "Unescaping a string ending with a single escape character should raise ValueError"
        assert escaper.unescape("`e") == "e", "Unescaping '`e' should produce 'e'"

    def test_roundtrip(self):
        escaper = PerCharacterEscaper.self_escape("`<>")

        def roundtrip(s):
            assert (
                escaper.unescape(escaper.escape(s)) == s
            ), f"Roundtrip of '{s}' did not return the original string"

        roundtrip("")
        roundtrip("<local>~`/")
