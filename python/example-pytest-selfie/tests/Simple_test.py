from selfie_lib.ArrayMap import ArrayMap


def test_simple():
    test = ArrayMap.empty().plus("key", "value")
    assert test.__len__() == 1
