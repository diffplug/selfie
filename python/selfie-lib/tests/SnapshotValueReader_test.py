import pytest
import base64

class SnapshotValueReader:
    def __init__(self, text):
        self.lines = iter(text.splitlines())
        self.current_key = None
        self.next_key = None
        self._advance()  # Initialize the first key

    @staticmethod
    def of(value):
        return SnapshotValueReader(value)

    def _advance(self):
        """Advance to the next key, setting up current and next keys."""
        try:
            while True:
                line = next(self.lines).strip()
                if line.startswith("╔═") and line.endswith("═╗"):
                    self.current_key = self.next_key
                    self.next_key = line[2:-2].strip()  # Extract key without the delimiters and leading/trailing spaces
                    return
        except StopIteration:
            self.current_key = self.next_key
            self.next_key = None

    def peekKey(self):
        """Peek at the next key without advancing."""
        return self.next_key

    def nextValue(self):
        """Retrieve the next value as a string or binary data, and advance to the following key."""
        value_lines = []
        try:
            while True:
                line = next(self.lines)
                if line.startswith("╔═") and line.endswith("═╗"):
                    break
                value_lines.append(line)
        except StopIteration:
            pass

        self._advance()  # Move to the next key after extracting the value

        value_text = "\n".join(value_lines).strip()
        # Placeholder to simulate a structure that has a valueString and valueBinary method
        class Value:
            def valueString(self):
                return value_text

            def valueBinary(self):
                # Assuming the binary data is base64 encoded
                return base64.b64decode(value_text.encode())

        return Value()

    def skipValue(self):
        """Skip the current value, advancing to the next key."""
        self._advance()

def test_no_escaping_needed():
    reader = SnapshotValueReader.of("""
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
    """.strip())
    assert reader.peekKey() == "00_empty"
    assert reader.peekKey() == "00_empty"
    assert reader.nextValue().valueString() == ""
    assert reader.peekKey() == "01_singleLineString"
    assert reader.peekKey() == "01_singleLineString"
    assert reader.nextValue().valueString() == "this is one line"
    assert reader.peekKey() == "01a_singleLineLeadingSpace"
    assert reader.nextValue().valueString() == " the leading space is significant"
    assert reader.peekKey() == "01b_singleLineTrailingSpace"
    assert reader.nextValue().valueString() == "the trailing space is significant "
    assert reader.peekKey() == "02_multiLineStringTrimmed"
    assert reader.nextValue().valueString() == "Line 1\nLine 2"
    assert reader.peekKey() == "03_multiLineStringTrailingNewline"
    assert reader.nextValue().valueString() == "Line 1\nLine 2\n"
    assert reader.peekKey() == "04_multiLineStringLeadingNewline"
    assert reader.nextValue().valueString() == "\nLine 1\nLine 2"
    assert reader.peekKey() == "05_notSureHowKotlinMultilineWorks"
    assert reader.nextValue().valueString() == ""

def test_invalid_names():
    with pytest.raises(Exception) as exc_info:
        SnapshotValueReader.of("╔═name ═╗").peekKey()
    assert str(exc_info.value) == "L1:Expected to start with '╔═ '"

    with pytest.raises(Exception) as exc_info:
        SnapshotValueReader.of("╔═ name═╗").peekKey()
    assert str(exc_info.value) == "L1:Expected to contain ' ═╗'"

    with pytest.raises(Exception) as exc_info:
        SnapshotValueReader.of("╔═  name ═╗").peekKey()
    assert str(exc_info.value) == "L1:Leading spaces are disallowed: ' name'"

    with pytest.raises(Exception) as exc_info:
        SnapshotValueReader.of("╔═ name  ═╗").peekKey()
    assert str(exc_info.value) == "L1:Trailing spaces are disallowed: 'name '"

    assert SnapshotValueReader.of("╔═ name ═╗ comment okay").peekKey() == "name"
    assert SnapshotValueReader.of("╔═ name ═╗okay here too").peekKey() == "name"
    assert SnapshotValueReader.of("╔═ name ═╗ okay  ╔═ ═╗ (it's the first ' ═╗' that counts)").peekKey() == "name"

def test_escape_characters_in_name():
    reader = SnapshotValueReader.of("""
        ╔═ test with [square brackets] in name ═╗
        ╔═ test with \\backslash\\ in name ═╗
        ╔═ test with
        newline
        in name ═╗
        ╔═ test with \ttab\t in name ═╗
        ╔═ test with ╔═ ascii art ═╗ in name ═╗
    """.strip())
    assert reader.peekKey() == "test with [square brackets] in name"
    assert reader.nextValue().valueString() == ""
    assert reader.peekKey() == "test with \\backslash\\ in name"
    assert reader.nextValue().valueString() == ""
    assert reader.peekKey().strip() == "test with\nnewline\nin name"
    assert reader.nextValue().valueString() == ""
    assert reader.peekKey() == "test with \ttab\t in name"
    assert reader.nextValue().valueString() == ""
    assert reader.peekKey() == "test with ╔═ ascii art ═╗ in name"
    assert reader.nextValue().valueString() == ""


def test_escape_characters_in_body():
    reader = SnapshotValueReader.of("""
        ╔═ ascii art okay ═╗
         ╔══╗
        ╔═ escaped iff on first line ═╗
        ╔══╗
        ╔═ body escape characters ═╗
        𐝁𐝃 linear a is dead
    """.strip())
    assert reader.peekKey() == "ascii art okay"
    assert reader.nextValue().valueString() == "╔══╗"
    assert reader.peekKey() == "escaped iff on first line"
    assert reader.nextValue().valueString() == "╔══╗"
    assert reader.peekKey() == "body escape characters"
    assert reader.nextValue().valueString() == "𐝁𐝃 linear a is dead"


def test_skip_values():
    test_content = """
        ╔═ 00_empty ═╗
        ╔═ 01_singleLineString ═╗
        this is one line
        ╔═ 02_multiLineStringTrimmed ═╗
        Line 1
        Line 2
        ╔═ 05_notSureHowKotlinMultilineWorks ═╗
    """.strip()

    def assert_key_value_with_skip(input_str, key, expected_value):
        reader = SnapshotValueReader.of(input_str)
        while reader.peekKey() != key:
            reader.skipValue()
        assert reader.peekKey() == key
        assert reader.nextValue().valueString() == expected_value
        # Assuming skipValue() correctly advances to the next entry,
        # the loop exits when no more keys are available.
        while reader.peekKey() is not None:
            reader.skipValue()

    assert_key_value_with_skip(test_content, "00_empty", "")
    assert_key_value_with_skip(test_content, "01_singleLineString", "this is one line")
    assert_key_value_with_skip(test_content, "02_multiLineStringTrimmed", "Line 1\nLine 2")

def test_binary():
    reader = SnapshotValueReader.of("╔═ Apple ═╗ base64 length 3 bytes\nc2Fk\n")
    assert reader.peekKey() == "Apple"
    # Assuming valueBinary returns the raw binary data from a base64-encoded string
    expected_binary = base64.b64decode("c2Fk")
    assert reader.nextValue().valueBinary() == expected_binary

