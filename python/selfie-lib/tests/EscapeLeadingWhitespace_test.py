from selfie_lib import EscapeLeadingWhitespace


def test_detection():
    # not enough to detect
    assert EscapeLeadingWhitespace.appropriate_for("") == EscapeLeadingWhitespace.ALWAYS
    assert (
        EscapeLeadingWhitespace.appropriate_for("abc") == EscapeLeadingWhitespace.ALWAYS
    )
    assert (
        EscapeLeadingWhitespace.appropriate_for("abc\nabc")
        == EscapeLeadingWhitespace.ALWAYS
    )

    # all spaces -> only tabs need escape
    assert (
        EscapeLeadingWhitespace.appropriate_for(" ") == EscapeLeadingWhitespace.ALWAYS
    )
    assert (
        EscapeLeadingWhitespace.appropriate_for("  ")
        == EscapeLeadingWhitespace.ONLY_ON_TAB
    )
    assert (
        EscapeLeadingWhitespace.appropriate_for("  \n  ")
        == EscapeLeadingWhitespace.ONLY_ON_TAB
    )

    # all tabs -> only space needs escape
    assert (
        EscapeLeadingWhitespace.appropriate_for("\t")
        == EscapeLeadingWhitespace.ONLY_ON_SPACE
    )
    assert (
        EscapeLeadingWhitespace.appropriate_for("\t\t")
        == EscapeLeadingWhitespace.ONLY_ON_SPACE
    )
    assert (
        EscapeLeadingWhitespace.appropriate_for("\t\n\t")
        == EscapeLeadingWhitespace.ONLY_ON_SPACE
    )

    # it's a mess -> everything needs escape
    assert (
        EscapeLeadingWhitespace.appropriate_for("\t\n  ")
        == EscapeLeadingWhitespace.ALWAYS
    )

    # single spaces and tabs -> only tabs need escape
    test_string = f"""/*
 * Copyright
 */
interface Foo [
{'\t'} bar()
]"""
    assert (
        EscapeLeadingWhitespace.appropriate_for(test_string)
        == EscapeLeadingWhitespace.ALWAYS
    )
