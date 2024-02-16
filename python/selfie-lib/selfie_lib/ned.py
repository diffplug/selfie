def fizzbuzz(n):
    fizzbuzz_results = ""
    for i in range(1, n):
        if i % 3 == 0 and i % 5 == 0:
            fizzbuzz_results += "FizzBuzz"
        elif i % 3 == 0:
            fizzbuzz_results += "Fizz"
        elif i % 5 == 0:
            fizzbuzz_results += "Buzz"
        else:
            fizzbuzz_results += f"{i}"