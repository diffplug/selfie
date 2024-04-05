from selfie_lib.ArrayMap import ArrayMap
from pytest_selfie.expectSelfie import expectSelfie


def test_simple():
    test = ArrayMap.empty().plus("key", "value")
    assert test.__len__() == 1

def test_comment_removal(): #selfieonce
    expectSelfie("nothing happens")
