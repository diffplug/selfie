# from selfie_lib.ArrayMap import ArrayMap
from selfie_lib.Selfie import expectSelfie


# def test_simple():
#     test = ArrayMap.empty().plus("key", "value")
#     assert test.__len__() == 1


def test_comment_removal():  # selfieonce
    expectSelfie("nothing happens").toBe_TODO 


def test_inline():
    expectSelfie("A").toBe_TODO()

    expectSelfie("testing123").toBe_TODO()


def test_disk():
    expectSelfie("A").toMatchDisk_TODO()
