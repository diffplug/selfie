# from selfie_lib.ArrayMap import ArrayMap
from selfie_lib.Selfie import expect_selfie


# def test_simple():
#     test = ArrayMap.empty().plus("key", "value")
#     assert test.__len__() == 1


def test_comment_removal():  # selfieonce
    expect_selfie("nothing happens").to_be_TODO()


def test_inline():
    expect_selfie(1).to_be_TODO(1)
    expect_selfie("A").to_be_TODO()

    expect_selfie("testing123").to_be_TODO()


def test_disk():
    expect_selfie("A").to_match_disk_TODO()

    expect_selfie(
        "Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a,"
    ).to_match_disk_TODO()
