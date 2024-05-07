from selfie_lib import expect_selfie


def test_write():
    expect_selfie("A").to_match_disk()


def test_read():
    expect_selfie("B").to_match_disk()
