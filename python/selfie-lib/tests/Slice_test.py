from selfie_lib import Slice

def test_unixLine():
    slice_1 = Slice("A single line")
    assert str(slice_1.unixLine(1)) == "A single line"
    
    one_two_three = Slice("\nI am the first\nI, the second\n\nFOURTH\n")
    assert str(one_two_three.unixLine(1)) == ""
    assert str(one_two_three.unixLine(2)) == "I am the first"
    assert str(one_two_three.unixLine(3)) == "I, the second"
    assert str(one_two_three.unixLine(4)) == ""
    assert str(one_two_three.unixLine(5)) == "FOURTH"
    assert str(one_two_three.unixLine(6)) == ""