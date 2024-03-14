from selfie_lib import SourceFile


def python_test(source_raw, function_call_plus_arg_raw, arg_raw=""):
    source = source_raw.replace("'", '"')
    function_call_plus_arg = function_call_plus_arg_raw.replace("'", '"')
    arg = arg_raw.replace("'", '"')
    parsed = SourceFile("UnderTest.py", source)
    to_be_literal = parsed.parse_to_be_like(1)
    assert to_be_literal._get_function_call_plus_arg() == function_call_plus_arg
    assert to_be_literal._get_arg() == arg


def python_test_error(source_raw, error_msg):
    try:
        python_test(source_raw, "unusedArg")
    except AssertionError as e:
        assert str(e) == error_msg


def todo():
    python_test(".toBe_TODO()", ".toBe_TODO()", "")
    python_test("  .toBe_TODO()  ", ".toBe_TODO()", "")
    python_test("  .toBe_TODO( )  ", ".toBe_TODO( )", "")
    python_test("  .toBe_TODO( \n )  ", ".toBe_TODO( \n )", "")


def numeric():
    python_test(".toBe(7)", ".toBe(7)", "7")
    python_test("  .toBe(7)", ".toBe(7)", "7")
    python_test(".toBe(7)  ", ".toBe(7)", "7")
    python_test("  .toBe(7)  ", ".toBe(7)", "7")
    python_test("  .toBe( 7 )  ", ".toBe( 7 )", "7")
    python_test("  .toBe(\n7)  ", ".toBe(\n7)", "7")
    python_test("  .toBe(7\n)  ", ".toBe(7\n)", "7")


def single_line_string():
    python_test(".toBe('7')", "'7'")
    python_test(".toBe('')", "''")
    python_test(".toBe( '' )", "''")
    python_test(".toBe( \n '' \n )", "''")
    python_test(".toBe( \n '78' \n )", "'78'")
    python_test(".toBe('\\'')", "'\\''")


def multi_line_string():
    python_test(".toBe('''7''')", "'''7'''")
    python_test(".toBe(''' 7 ''')", "''' 7 '''")
    python_test(".toBe('''\n7\n''')", "'''\n7\n'''")
    python_test(".toBe(''' ' '' ' ''')", "''' ' '' ' '''")


def error_unclosed():
    python_test_error(
        ".toBe(", "Appears to be an unclosed function call `.toBe()` on line 1"
    )
    python_test_error(
        ".toBe(  \n ", "Appears to be an unclosed function call `.toBe()` on line 1"
    )
    python_test_error(
        ".toBe_TODO(",
        "Appears to be an unclosed function call `.toBe_TODO()` on line 1",
    )
    python_test_error(
        ".toBe_TODO(  \n ",
        "Appears to be an unclosed function call `.toBe_TODO()` on line 1",
    )
    python_test_error(
        ".toBe_TODO(')", 'Appears to be an unclosed string literal `"` on line 1'
    )
    python_test_error(
        ".toBe_TODO(''')",
        'Appears to be an unclosed multiline string literal `"""` on line 1',
    )


def error_non_primitive():
    python_test_error(
        ".toBe(1 + 1)",
        "Non-primitive literal in `.toBe()` starting at line 1: error for character `+` on line 1",
    )
    python_test_error(
        ".toBe('1' + '1')",
        "Non-primitive literal in `.toBe()` starting at line 1: error for character `+` on line 1",
    )
    python_test_error(
        ".toBe('''1''' + '''1''')",
        "Non-primitive literal in `.toBe()` starting at line 1: error for character `+` on line 1",
    )
