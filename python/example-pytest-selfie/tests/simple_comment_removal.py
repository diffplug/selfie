from selfie_lib.Selfie import expect_selfie


def test_comment_removal():  # selfieonce
    expect_selfie("nothing happens").to_be_TODO()
