from selfie_lib import fizzbuzz

def test_fizzbuzz():
    # Test the function with a small number to keep the test simple
    result = fizzbuzz(15)
    expected_result = [
        "1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz",
        "11", "Fizz", "13", "14", "FizzBuzz"
    ]
    assert result == expected_result