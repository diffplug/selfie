from selfie_lib import SourceFile


def test_todo():
    source_file = SourceFile("UnderTest.py", ".toBe_TODO()")
    assert str(source_file.parse_to_be_like(1).function_call_plus_arg) == ".toBe_TODO()"
    assert str(source_file.parse_to_be_like(1).arg) == ""


def test_numeric():
    source_file = SourceFile("UnderTest.py", ".toBe(7)")
    assert str(source_file.parse_to_be_like(1).function_call_plus_arg) == ".toBe(7)"
    assert str(source_file.parse_to_be_like(1).arg) == "7"


def test_single_line_string():
    source_file = SourceFile("UnderTest.py", ".toBe('7')")
    assert str(source_file.parse_to_be_like(1).function_call_plus_arg) == ".toBe('7')"
    assert str(source_file.parse_to_be_like(1).arg) == "'7'"


def test_multi_line_string():
    source_file = SourceFile("UnderTest.py", ".toBe('''7''')")
    assert (
        str(source_file.parse_to_be_like(1).function_call_plus_arg) == ".toBe('''7''')"
    )
    assert str(source_file.parse_to_be_like(1).arg) == "'''7'''"


def test_error_unclosed():
    source_file = SourceFile("UnderTest.py", ".toBe(")
    assert_raises_error(
        source_file, 'Appears to be an unclosed string literal `"` on line 1'
    )

    source_file = SourceFile("UnderTest.py", ".toBe_TODO(')")
    assert_raises_error(
        source_file, 'Appears to be an unclosed string literal `"` on line 1'
    )


def test_error_non_primitive():
    source_file = SourceFile("UnderTest.py", ".toBe(1 + 1)")
    assert_raises_error(
        source_file,
        "Non-primitive literal in `.toBe()` starting at line 1: error for character `+` on line 1",
    )


def assert_raises_error(source_file, error_msg):
    try:
        source_file.parse_to_be_like(1)
        assert False, "Expected an AssertionError, but none was raised."
    except AssertionError as e:
        assert str(e) == error_msg
