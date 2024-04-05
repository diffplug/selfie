# from selfie_lib.ArrayMap import ArrayMap
from selfie_lib.Selfie import expectSelfie


# def test_simple():
#     test = ArrayMap.empty().plus("key", "value")
#     assert test.__len__() == 1


def test_comment_removal():  # selfieonce
    expectSelfie(
        "nothing happens"
    ).toBe_TODO()  # selfie doesn't look in every single file for selfieonce comments, it gets triggered to look by the todo call
