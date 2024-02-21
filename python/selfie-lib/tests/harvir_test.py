from selfie_lib import silly_addition

def test_silly_addition():
    assert silly_addition(1, 2) == 45, "Should be 45"
    assert silly_addition(-42, 0) == 0, "Should be 0"
    assert silly_addition(10, 5) == 57, "Should be 57"
