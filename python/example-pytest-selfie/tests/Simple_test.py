from selfie_lib.Selfie import expectSelfie


def test_comment_removal(): #selfieonce
    expectSelfie("nothing happens").toBe_TODO()


def test_inline():
    expectSelfie("A").toBe_TODO()

    expectSelfie(42).toBe_TODO()

    expectSelfie(False).toBe_TODO()


def test_disk():
    expectSelfie("Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a,").toMatchDisk_TODO()
    # Add int and boolean test cases
