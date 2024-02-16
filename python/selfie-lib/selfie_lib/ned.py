def fizzbuzz(n):
    fizzbuzz_results = []
    for i in range(1, n + 1):
        if i % 3 == 0 and i % 5 == 0:
            fizzbuzz_results.append("FizzBuzz")
        elif i % 3 == 0:
            fizzbuzz_results.append("Fizz")
        elif i % 5 == 0:
            fizzbuzz_results.append("Buzz")
        else:
            fizzbuzz_results.append(f"{i}")
    return fizzbuzz_results