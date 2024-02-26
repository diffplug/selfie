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
    assert map == ArrayMap.empty().plus(key1, value1).plus(key2, value2).plus(key3, value3)

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
