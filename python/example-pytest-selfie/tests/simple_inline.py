from selfie_lib.Selfie import expect_selfie


def test_inline():
    expect_selfie(1).to_be_TODO(1)
    expect_selfie("A").to_be_TODO()

    expect_selfie("testing123\n456789").to_be_TODO()
