from selfie_lib.Selfie import expect_selfie


def test_disk():
    expect_selfie("A").to_match_disk_TODO()
