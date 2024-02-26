import unittest
from selfie_lib.ArrayMap import ArrayMap

class ArrayMapTest(unittest.TestCase):
    def assertEmpty(self, map):
        self.assertEqual(len(map), 0)
        self.assertEqual(list(map.keys()), [])
        self.assertEqual(list(map.values()), [])
        self.assertEqual(list(map.items()), [])
        with self.assertRaises(KeyError):
            _ = map["key"]
        self.assertEqual(map, {})
        self.assertEqual(map, ArrayMap.empty())

    def assertSingle(self, map, key, value):
        self.assertEqual(len(map), 1)
        self.assertEqual(set(map.keys()), {key})
        self.assertEqual(list(map.values()), [value])
        self.assertEqual(set(map.items()), {(key, value)})
        self.assertEqual(map[key], value)
        with self.assertRaises(KeyError):
            _ = map[key + "blah"]
        self.assertEqual(map, {key: value})
        self.assertEqual(map, ArrayMap.empty().plus(key, value))

    def assertDouble(self, map, key1, value1, key2, value2):
        self.assertEqual(len(map), 2)
        self.assertEqual(set(map.keys()), {key1, key2})
        self.assertEqual(list(map.values()), [value1, value2])
        self.assertEqual(set(map.items()), {(key1, value1), (key2, value2)})
        self.assertEqual(map[key1], value1)
        self.assertEqual(map[key2], value2)
        with self.assertRaises(KeyError):
            _ = map[key1 + "blah"]
        self.assertEqual(map, {key1: value1, key2: value2})
        self.assertEqual(map, {key2: value2, key1: value1})
        self.assertEqual(map, ArrayMap.empty().plus(key1, value1).plus(key2, value2))
        self.assertEqual(map, ArrayMap.empty().plus(key2, value2).plus(key1, value1))

    def assertTriple(self, map, key1, value1, key2, value2, key3, value3):
        self.assertEqual(len(map), 3)
        self.assertEqual(set(map.keys()), {key1, key2, key3})
        self.assertEqual(list(map.values()), [value1, value2, value3])
        self.assertEqual(set(map.items()), {(key1, value1), (key2, value2), (key3, value3)})
        self.assertEqual(map[key1], value1)
        self.assertEqual(map[key2], value2)
        self.assertEqual(map[key3], value3)
        with self.assertRaises(KeyError):
            _ = map[key1 + "blah"]
        self.assertEqual(map, {key1: value1, key2: value2, key3: value3})
        self.assertEqual(map, ArrayMap.empty().plus(key1, value1).plus(key2, value2).plus(key3, value3))

    def test_empty(self):
        self.assertEmpty(ArrayMap.empty())

    def test_single(self):
        empty = ArrayMap.empty()
        single = empty.plus("one", "1")
        self.assertEmpty(empty)
        self.assertSingle(single, "one", "1")

    def test_double(self):
        empty = ArrayMap.empty()
        single = empty.plus("one", "1")
        double = single.plus("two", "2")
        self.assertEmpty(empty)
        self.assertSingle(single, "one", "1")
        self.assertDouble(double, "one", "1", "two", "2")
        self.assertDouble(single.plus("a", "sorted"), "a", "sorted", "one", "1")

        with self.assertRaises(ValueError) as context:
            single.plus("one", "2")
        self.assertEqual(str(context.exception), "Key already exists")

    def test_triple(self):
        triple = ArrayMap.empty().plus("1", "one").plus("2", "two").plus("3", "three")
        self.assertTriple(triple, "1", "one", "2", "two", "3", "three")

    def test_multi(self):
        self.test_triple() 
        triple = ArrayMap.empty().plus("2", "two").plus("3", "three").plus("1", "one")
        self.assertTriple(triple, "1", "one", "2", "two", "3", "three")
        triple = ArrayMap.empty().plus("3", "three").plus("1", "one").plus("2", "two")
        self.assertTriple(triple, "1", "one", "2", "two", "3", "three")

if __name__ == '__main__':
    unittest.main()
