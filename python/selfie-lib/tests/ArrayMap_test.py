import pytest

from selfie_lib.ArrayMap import ArrayMap


def assertEmpty(map):
    assert len(map) == 0
    assert list(map.keys()) == []
    assert list(map.values()) == []
    assert list(map.items()) == []
    with pytest.raises(KeyError):
        _ = map["key"]
    assert map == {}
    assert map == ArrayMap.empty()


def assertSingle(map, key, value):
    assert len(map) == 1
    assert set(map.keys()) == {key}
    assert list(map.values()) == [value]
    assert set(map.items()) == {(key, value)}
    assert map[key] == value
    with pytest.raises(KeyError):
        _ = map[key + "blah"]
    assert map == {key: value}
    assert map == ArrayMap.empty().plus(key, value)


def assertDouble(map, key1, value1, key2, value2):
    assert len(map) == 2
    assert set(map.keys()) == {key1, key2}
    assert list(map.values()) == [value1, value2]
    assert set(map.items()) == {(key1, value1), (key2, value2)}
    assert map[key1] == value1
    assert map[key2] == value2
    with pytest.raises(KeyError):
        _ = map[key1 + "blah"]
    assert map == {key1: value1, key2: value2}
    assert map == {key2: value2, key1: value1}
    assert map == ArrayMap.empty().plus(key1, value1).plus(key2, value2)
    assert map == ArrayMap.empty().plus(key2, value2).plus(key1, value1)


def assertTriple(map, key1, value1, key2, value2, key3, value3):
    assert len(map) == 3
    assert set(map.keys()) == {key1, key2, key3}
    assert list(map.values()) == [value1, value2, value3]
    assert set(map.items()) == {(key1, value1), (key2, value2), (key3, value3)}
    assert map[key1] == value1
    assert map[key2] == value2
    assert map[key3] == value3
    with pytest.raises(KeyError):
        _ = map[key1 + "blah"]
    assert map == {key1: value1, key2: value2, key3: value3}
    assert map == ArrayMap.empty().plus(key1, value1).plus(key2, value2).plus(
        key3, value3
    )


def test_empty():
    assertEmpty(ArrayMap.empty())


def test_single():
    empty = ArrayMap.empty()
    single = empty.plus("one", "1")
    assertEmpty(empty)
    assertSingle(single, "one", "1")


def test_double():
    empty = ArrayMap.empty()
    single = empty.plus("one", "1")
    double = single.plus("two", "2")
    assertEmpty(empty)
    assertSingle(single, "one", "1")
    assertDouble(double, "one", "1", "two", "2")
    assertDouble(single.plus("a", "sorted"), "a", "sorted", "one", "1")

    with pytest.raises(ValueError) as context:
        single.plus("one", "2")
    assert str(context.value) == "Key already exists"


def test_triple():
    triple = ArrayMap.empty().plus("1", "one").plus("2", "two").plus("3", "three")
    assertTriple(triple, "1", "one", "2", "two", "3", "three")


def test_multi():
    test_triple()  # Calling another test function directly is unusual but works
    triple = ArrayMap.empty().plus("2", "two").plus("3", "three").plus("1", "one")
    assertTriple(triple, "1", "one", "2", "two", "3", "three")
    triple = ArrayMap.empty().plus("3", "three").plus("1", "one").plus("2", "two")
    assertTriple(triple, "1", "one", "2", "two", "3", "three")


def test_minus_sorted_indices():
    initial_map = (
        ArrayMap.empty()
        .plus("1", "one")
        .plus("2", "two")
        .plus("3", "three")
        .plus("4", "four")
    )
    modified_map = initial_map.minus_sorted_indices([1, 3])
    assert len(modified_map) == 2
    assert list(modified_map.keys()) == ["1", "3"]
    assert list(modified_map.values()) == ["one", "three"]
    with pytest.raises(KeyError):
        _ = modified_map["2"]
    with pytest.raises(KeyError):
        _ = modified_map["4"]
    assert modified_map == {"1": "one", "3": "three"}


def test_plus_with_existing_keys():
    map_with_duplicates = ArrayMap.empty().plus("a", "alpha").plus("b", "beta")
    with pytest.raises(ValueError):
        map_with_duplicates.plus("a", "new alpha")
    updated_map = map_with_duplicates.plus("c", "gamma")
    assert len(updated_map) == 3
    assert updated_map["a"] == "alpha"
    assert updated_map["b"] == "beta"
    assert updated_map["c"] == "gamma"
    modified_map = map_with_duplicates.minus_sorted_indices([0]).plus(
        "a", "updated alpha"
    )
    assert len(modified_map) == 2
    assert modified_map["a"] == "updated alpha"
    assert modified_map["b"] == "beta"


def test_map_length():
    undertest = ArrayMap.empty()
    assert len(undertest) == 0, "Length should be 0 for an empty map"
    undertest = undertest.plus("key1", "value1")
    assert len(undertest) == 1, "Length should be 1 after adding one item"
    undertest = undertest.plus("key2", "value2")
    assert len(undertest) == 2, "Length should be 2 after adding another item"
    undertest = undertest.plus("key3", "value3")
    assert len(undertest) == 3, "Length should be 3 after adding a third item"
    undertest = undertest.minus_sorted_indices([1])
    assert len(undertest) == 2, "Length should be 2 after removing one item"
    undertest = undertest.minus_sorted_indices([0])
    assert len(undertest) == 1, "Length should be 1 after removing another item"
    undertest = undertest.minus_sorted_indices([0])
    assert len(undertest) == 0, "Length should be 0 after removing all items"


def test_keys():
    assert ArrayMap.empty().keys().__len__() == 0
    undertest = ArrayMap.empty().plus("a", "alpha").plus("b", "beta")
    assert undertest.keys()[0] == "a"
    assert undertest.keys()[1] == "b"


def test_items():
    assert ArrayMap.empty().items().__len__() == 0
    map = ArrayMap.empty().plus("a", "alpha").plus("b", "beta")
    assert map.items()[0] == ("a", "alpha")
    assert map.items()[1] == ("b", "beta")
