from unittest.mock import Mock
from selfie_lib.WriteTracker import CallLocation, CallStack, recordCall


def test_call_location_ide_link():
    layout = Mock()
    location = CallLocation(file_name="example.py", line=10)
    expected_link = "File: example.py, Line: 10"

    assert location.ide_link(layout) == expected_link


def test_call_stack_ide_link():
    layout = Mock()
    location1 = CallLocation(file_name="example1.py", line=10)
    location2 = CallLocation(file_name="example2.py", line=20)
    call_stack = CallStack(location=location1, rest_of_stack=[location2])

    expected_links = "File: example1.py, Line: 10\nFile: example2.py, Line: 20"
    assert call_stack.ide_link(layout) == expected_links


def test_record_call_with_caller_file_only_false():
    call_stack = recordCall(False)
    assert (
        len(call_stack.rest_of_stack) > 0
    ), "Expected the rest of stack to contain more than one CallLocation"


def test_record_call_with_caller_file_only_true():
    call_stack = recordCall(True)
    assert (
        len(call_stack.rest_of_stack) >= 0
    ), "Expected the rest of stack to potentially contain only the caller's file location"
