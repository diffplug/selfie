import base64
import pytest
from selfie_lib import expect_selfie

def test_empty_binary_base64():
    """Test base64 encoding of empty byte array"""
    expect_selfie(bytes()).to_be_base64_TODO()

def test_large_binary_base64():
    """Test base64 encoding of large byte array (256 bytes)"""
    data = bytes(range(256))
    expect_selfie(data).to_be_base64_TODO()

def test_binary_file():
    """Test writing binary data to a file"""
    data = b"test binary data"
    expect_selfie(data).to_be_file_TODO("test_binary.bin")

def test_binary_file_duplicate():
    """Test writing same binary data to a file multiple times"""
    data = b"same data"
    # Same data should work
    expect_selfie(data).to_be_file("duplicate.bin")
    expect_selfie(data).to_be_file("duplicate.bin")

def test_binary_file_mismatch():
    """Test error handling for mismatched binary data"""
    with pytest.raises(AssertionError):
        expect_selfie(b"different").to_be_file("test_binary.bin")

def test_binary_file_not_found():
    """Test error handling for non-existent file"""
    with pytest.raises(AssertionError) as exc_info:
        expect_selfie(b"test").to_be_file("nonexistent.bin")
    assert "no such file" in str(exc_info.value)

def test_base64_mismatch():
    """Test error handling for mismatched base64 data"""
    data = b"test data"
    encoded = base64.b64encode(b"different data").decode()
    with pytest.raises(AssertionError):
        expect_selfie(data).to_be_base64(encoded)

def test_readonly_mode_todo(monkeypatch):
    """Test error handling in readonly mode for TODO methods"""
    from selfie_lib import Mode, _selfieSystem

    # Temporarily set mode to readonly
    original_mode = _selfieSystem().mode
    _selfieSystem().mode = Mode.readonly

    try:
        with pytest.raises(AssertionError) as exc_info:
            expect_selfie(b"test").to_be_file_TODO("test.bin")
        assert "readonly mode" in str(exc_info.value)

        with pytest.raises(AssertionError) as exc_info:
            expect_selfie(b"test").to_be_base64_TODO()
        assert "readonly mode" in str(exc_info.value)
    finally:
        # Restore original mode
        _selfieSystem().mode = original_mode
