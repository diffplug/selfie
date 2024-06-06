from selfie_lib import expect_selfie


def test_quickstart():
    expect_selfie([1, 2, 3]).to_be([1, 2, 3])
