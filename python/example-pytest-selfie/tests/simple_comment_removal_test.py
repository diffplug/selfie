from selfie_lib.Selfie import expect_selfie


def test_comment_removal():  # selfieonce
    expect_selfie("no op").to_be("no op")
