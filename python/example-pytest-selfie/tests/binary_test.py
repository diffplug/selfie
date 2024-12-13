import pytest
from selfie_lib import expect_selfie


def test_empty_binary_base64():
    """Test base64 encoding of empty byte array"""
    expect_selfie(bytes()).to_be_base64("")


def test_large_binary_base64():
    """Test base64 encoding of large byte array (256 bytes)"""
    data = bytes(range(256))
    expect_selfie(data).to_be_base64(
        "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w=="
    )


def test_binary_file():
    """Test writing binary data to a file"""
    data = b"test binary data"
    expect_selfie(data).to_be_file("tests/binary_test__test_binary_file.bin")


def test_binary_file_duplicate_equal():
    """Test writing same binary data to a file multiple times"""
    expect_selfie(b"equal").to_be_file(
        "tests/binary_test__test_binary_file_duplicate_equal.bin"
    )
    expect_selfie(b"equal").to_be_file(
        "tests/binary_test__test_binary_file_duplicate_equal.bin"
    )


def test_binary_file_mismatch():
    """Test error handling for mismatched binary data"""
    with pytest.raises(AssertionError):
        expect_selfie(b"different").to_be_file(
            "tests/binary_test__SHOULD_NOT_EXIST.bin"
        )


def test_binary_file_not_found():
    """Test error handling for non-existent file"""
    with pytest.raises(AssertionError) as exc_info:
        expect_selfie(b"test").to_be_file("tests/binary_test__SHOULD_NOT_EXIST.bin")
    assert "no such file" in str(exc_info.value)


def test_base64_mismatch():
    """Test error handling for mismatched base64 data"""
    with pytest.raises(Exception) as exc_info:
        expect_selfie(b"test data").to_be_base64("AAAA")
    expect_selfie(
        safify(str(exc_info.value))
    ).to_be("""Snapshot mismatch, TODO: string comparison
- update this snapshot by adding `_TODO` to the function name
- update all snapshots in this file by adding `#safewordonce` or `#safewordWRITE`""")

def safify(string: str) -> str:
    return string.replace("selfie", "safeword").replace("SELFIE", "safeword")

