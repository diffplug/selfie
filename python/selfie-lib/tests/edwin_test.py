from selfie_lib import simple_subtraction

def test_simple_subtraction():
    assert simple_subtraction(2, 2) == 0, "Should be 0"
    assert simple_subtraction(0, 0) == 0, "Should be 0"
    assert simple_subtraction(100, 42) == 58, "Should be 58"

