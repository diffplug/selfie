from selfie_lib import expect_selfie


def primes_below(n):
    if n <= 2:
        return []
    sieve = [True] * n
    sieve[0] = sieve[1] = False

    for i in range(2, int(n**0.5) + 1):
        if sieve[i]:
            for j in range(i * i, n, i):
                sieve[j] = False

    return [i for i in range(n) if sieve[i]]


def test_primes_below_100():
    expect_selfie(primes_below(100)).to_be(
        [
            2,
            3,
            5,
            7,
            11,
            13,
            17,
            19,
            23,
            29,
            31,
            37,
            41,
            43,
            47,
            53,
            59,
            61,
            67,
            71,
            73,
            79,
            83,
            89,
            97,
        ]
    )
