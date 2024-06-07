import random

from selfie_lib import cache_selfie


def random_str() -> str:
    return str(random.random())


def test_cache_selfie():
    cache_selfie(lambda: str(random.random())).to_be("0.46009462251400757")
    cache_selfie(random_str).to_be("0.6134874512330031")


