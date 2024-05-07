from selfie_lib import expect_selfie

# def test_read_pass():
#     expect_selfie("A").to_be("A")


# def test_read_fail():
#     expect_selfie("A").to_be("B")


def test_write():
    expect_selfie("B").to_be("B")
    expect_selfie(20000).to_be(20_000)
    expect_selfie([1, 2, 3]).to_be([1, 2, 3])
    expect_selfie(("a", 2, 3)).to_be(("a", 2, 3))
    expect_selfie({"a": 1, "b": 2}).to_be({"a": 1, "b": 2})
