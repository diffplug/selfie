import pytest

from selfie_lib import SourceFile


def python_test(source_raw, function_call_plus_arg_raw, arg_raw=""):
    source = source_raw.replace("'", '"')
    function_call_plus_arg = function_call_plus_arg_raw.replace("'", '"')
    arg = arg_raw.replace("'", '"')
    parsed = SourceFile("UnderTest.py", source)
    to_be_literal = parsed.parse_to_be_like(1)
    assert to_be_literal._get_function_call_plus_arg() == function_call_plus_arg  # noqa: SLF001
    assert to_be_literal._get_arg() == arg  # noqa: SLF001


def python_test_error(source_raw, error_msg):
    with pytest.raises(ValueError, match=error_msg):
        python_test(source_raw, "unusedArg")


def todo():
    python_test(".to_be_TODO()", ".to_be_TODO()", "")
    python_test("  .to_be_TODO()  ", ".to_be_TODO()", "")
    python_test("  .to_be_TODO( )  ", ".to_be_TODO( )", "")
    python_test("  .to_be_TODO( \n )  ", ".to_be_TODO( \n )", "")


def numeric():
    python_test(".to_be(7)", ".to_be(7)", "7")
    python_test("  .to_be(7)", ".to_be(7)", "7")
    python_test(".to_be(7)  ", ".to_be(7)", "7")
    python_test("  .to_be(7)  ", ".to_be(7)", "7")
    python_test("  .to_be( 7 )  ", ".to_be( 7 )", "7")
    python_test("  .to_be(\n7)  ", ".to_be(\n7)", "7")
    python_test("  .to_be(7\n)  ", ".to_be(7\n)", "7")


def single_line_string():
    python_test(".to_be('7')", "'7'")
    python_test(".to_be('')", "''")
    python_test(".to_be( '' )", "''")
    python_test(".to_be( \n '' \n )", "''")
    python_test(".to_be( \n '78' \n )", "'78'")
    python_test(".to_be('\\'')", "'\\''")


def multi_line_string():
    python_test(".to_be('''7''')", "'''7'''")
    python_test(".to_be(''' 7 ''')", "''' 7 '''")
    python_test(".to_be('''\n7\n''')", "'''\n7\n'''")
    python_test(".to_be(''' ' '' ' ''')", "''' ' '' ' '''")


def error_unclosed():
    python_test_error(
        ".to_be(", "Appears to be an unclosed function call `.to_be()` on line 1"
    )
    python_test_error(
        ".to_be(  \n ", "Appears to be an unclosed function call `.to_be()` on line 1"
    )
    python_test_error(
        ".to_be_TODO(",
        "Appears to be an unclosed function call `.to_be_TODO()` on line 1",
    )
    python_test_error(
        ".to_be_TODO(  \n ",
        "Appears to be an unclosed function call `.to_be_TODO()` on line 1",
    )
    python_test_error(
        ".to_be_TODO(')", 'Appears to be an unclosed string literal `"` on line 1'
    )
    python_test_error(
        ".to_be_TODO(''')",
        'Appears to be an unclosed multiline string literal `"""` on line 1',
    )


def error_non_primitive():
    python_test_error(
        ".to_be(1 + 1)",
        "Non-primitive literal in `.to_be()` starting at line 1: error for character `+` on line 1",
    )
    python_test_error(
        ".to_be('1' + '1')",
        "Non-primitive literal in `.to_be()` starting at line 1: error for character `+` on line 1",
    )
    python_test_error(
        ".to_be('''1''' + '''1''')",
        "Non-primitive literal in `.to_be()` starting at line 1: error for character `+` on line 1",
    )
