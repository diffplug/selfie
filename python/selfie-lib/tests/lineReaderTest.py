from selfie_lib import LineReader

def test_should_find_unix_separator_from_binary():
    reader = LineReader.for_binary(b"This is a new line\n")
    assert reader.unix_newlines() == True
    assert reader.read_line() == "This is a new line"

def test_should_find_windows_separator_from_binary():
    reader = LineReader.for_binary(b"This is a new line\r\n")
    assert reader.unix_newlines() == False
    assert reader.read_line() == "This is a new line"

def test_should_find_unix_separator_from_string():
    reader = LineReader.for_string("This is a new line\n")
    assert reader.unix_newlines() == True
    assert reader.read_line() == "This is a new line"

def test_should_find_windows_separator_from_string():
    reader = LineReader.for_string("This is a new line\r\n")
    assert reader.unix_newlines() == False
    assert reader.read_line() == "This is a new line"

def test_should_get_unix_line_separator_when_there_is_none():
    reader = LineReader.for_binary(b"This is a new line")
    assert reader.unix_newlines() == True
    assert reader.read_line() == "This is a new line"

def test_should_read_next_line_without_problem():
    reader = LineReader.for_binary(b"First\r\nSecond\r\n")
    assert reader.unix_newlines() == False
    assert reader.read_line() == "First"
    assert reader.unix_newlines() == False
    assert reader.read_line() == "Second"
    assert reader.unix_newlines() == False

def test_should_use_first_line_separator_and_ignore_next():
    reader = LineReader.for_binary(b"First\r\nAnother separator\n")
    assert reader.unix_newlines() == False
    assert reader.read_line() == "First"
    assert reader.unix_newlines() == False
    assert reader.read_line() == "Another separator"
    assert reader.unix_newlines() == False
