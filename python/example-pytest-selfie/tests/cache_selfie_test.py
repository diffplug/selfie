from selfie_lib.Selfie import cache_selfie_string
import random


def test_cache_selfie():
    cache_selfie_string(lambda: str(random.random())).to_be("0.6623096709843852")
