import pytest
from selfie_lib import SnapshotValueReader, ParseException


class TestSnapshotValueReader:
    def test_no_escaping_needed(self):
        reader = SnapshotValueReader.of(
            """
            ╔═ 00_empty ═╗
            ╔═ 01_singleLineString ═╗
            this is one line
            ╔═ 01a_singleLineLeadingSpace ═╗
             the leading space is significant
            ╔═ 01b_singleLineTrailingSpace ═╗
            the trailing space is significant
            ╔═ 02_multiLineStringTrimmed ═╗
            Line 1
            Line 2
            ╔═ 03_multiLineStringTrailingNewline ═╗
            Line 1
            Line 2

            ╔═ 04_multiLineStringLeadingNewline ═╗

            Line 1
            Line 2
            ╔═ 05_notSureHowKotlinMultilineWorks ═╗
        """.strip()
        )
        assert reader.peek_key() == "00_empty"
        assert reader.next_value().value_string() == ""
        assert reader.peek_key() == "01_singleLineString"
        assert reader.next_value().value_string() == "this is one line"
        assert reader.peek_key() == "01a_singleLineLeadingSpace"
        assert reader.next_value().value_string() == " the leading space is significant"
        assert reader.peek_key() == "01b_singleLineTrailingSpace"
        assert (
            reader.next_value().value_string() == "the trailing space is significant "
        )
        assert reader.peek_key() == "02_multiLineStringTrimmed"
        assert reader.next_value().value_string() == "Line 1\nLine 2"
        assert reader.peek_key() == "03_multiLineStringTrailingNewline"
        assert reader.next_value().value_string() == "Line 1\nLine 2\n"
        assert reader.peek_key() == "04_multiLineStringLeadingNewline"
        assert reader.next_value().value_string() == "\nLine 1\nLine 2"
        assert reader.peek_key() == "05_notSureHowKotlinMultilineWorks"
        assert reader.next_value().value_string() == ""

    def test_invalid_names(self):
        with pytest.raises(ParseException) as exc_info:
            SnapshotValueReader.of("╔═name ═╗").peek_key()
        assert "Expected to start with '╔═ '" in str(exc_info.value)

        with pytest.raises(ParseException) as exc_info:
            SnapshotValueReader.of("╔═ name═╗").peek_key()
        assert "Expected to contain ' ═╗'" in str(exc_info.value)

        with pytest.raises(ParseException) as exc_info:
            SnapshotValueReader.of("╔═  name ═╗").peek_key()
        assert "Leading spaces are disallowed: ' name'" in str(exc_info.value)

        with pytest.raises(ParseException) as exc_info:
            SnapshotValueReader.of("╔═ name  ═╗").peek_key()
        assert "Trailing spaces are disallowed: 'name '" in str(exc_info.value)

        assert SnapshotValueReader.of("╔═ name ═╗ comment okay").peek_key() == "name"
        assert SnapshotValueReader.of("╔═ name ═╗okay here too").peek_key() == "name"
        assert (
            SnapshotValueReader.of(
                "╔═ name ═╗ okay  ╔═ ═╗ (it's the first ' ═╗' that counts)"
            ).peek_key()
            == "name"
        )

    def test_escape_characters_in_name(self):
        reader = SnapshotValueReader.of(
            """
            ╔═ test with \\(square brackets\\) in name ═╗
            ╔═ test with \\\\backslash\\\\ in name ═╗
            ╔═ test with\\nnewline\\nin name ═╗
            ╔═ test with \\ttab\\t in name ═╗
            ╔═ test with \\┌\\─ ascii art \\─\\┐ in name ═╗
        """.strip()
        )
        assert reader.peek_key() == "test with (square brackets) in name"
        assert reader.next_value().value_string() == ""
        assert reader.peek_key() == "test with \\backslash\\ in name"
        assert reader.next_value().value_string() == ""
        assert reader.peek_key().strip() == "test with\nnewline\nin name"
        assert reader.next_value().value_string() == ""
        assert reader.peek_key() == "test with \ttab\t in name"
        assert reader.next_value().value_string() == ""
        assert reader.peek_key() == "test with ╔═ ascii art ═╗ in name"
        assert reader.next_value().value_string() == ""

    def assert_key_value_with_skip(self, key, expected_value):
        reader = SnapshotValueReader.of(self)
        while reader.peek_key() != key:
            reader.skip_value()
        assert reader.peek_key() == key
        assert reader.next_value().value_string() == expected_value
        while reader.peek_key() is not None:
            reader.skip_value()

    def test_skip_values(self):
        test_content = """
            ╔═ 00_empty ═╗
            ╔═ 01_singleLineString ═╗
            this is one line
            ╔═ 02_multiLineStringTrimmed ═╗
            Line 1
            Line 2
            ╔═ 05_notSureHowKotlinMultilineWorks ═╗
        """.strip()
        self.assert_key_value_with_skip(test_content, "00_empty", "")
        self.assert_key_value_with_skip(
            test_content, "01_singleLineString", "this is one line"
        )
        self.assert_key_value_with_skip(
            test_content, "02_multiLineStringTrimmed", "Line 1\nLine 2"
        )

    def test_binary():
        reader = SnapshotValueReader(
            """╔═ Apple ═╗ base64 length 3 bytes
    c2Fk
    """
        )
        assert reader.peek_key() == "Apple"
        assert reader.next_value() == b"sad"
