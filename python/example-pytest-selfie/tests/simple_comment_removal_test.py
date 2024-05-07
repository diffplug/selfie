from selfie_lib import expect_selfie


def test_comment_removal():
    expect_selfie("no op").to_be("no op")
