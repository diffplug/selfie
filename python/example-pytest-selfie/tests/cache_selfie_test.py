import random

from selfie_lib import cache_selfie


def test_cache_selfie():
    cache_selfie(lambda: str(random.random())).to_be("0.6623096709843852")
