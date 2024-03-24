using NUnit.Framework;
using System;
using System.Collections.Generic;
using System.Linq;

namespace com.diffplug.selfie;

[TestFixture]
public class ArrayMapTest {
  [Test]
  public void Empty() {
    var empty = ArrayMap<string, string>.Empty;
    AssertEmpty(empty);
  }

  [Test]
  public void Single() {
    var empty = ArrayMap<string, string>.Empty;
    var single = empty.Plus("one", "1");
    AssertEmpty(empty);
    AssertSingle(single, "one", "1");
  }

  [Test]
  public void Double() {
    var empty = ArrayMap<string, string>.Empty;
    var single = empty.Plus("one", "1");
    var doubleMap = single.Plus("two", "2");
    AssertEmpty(empty);
    AssertSingle(single, "one", "1");
    AssertDouble(doubleMap, "one", "1", "two", "2");
    // ensure sorted also
    AssertDouble(single.Plus("a", "sorted"), "a", "sorted", "one", "1");

    var ex = Assert.Throws<ArgumentException>(() => single.Plus("one", "2"));
    Assert.That(ex.Message, Is.EqualTo("Key already exists: one"));
  }

  // [Test]
  // public void Of() {
  //   AssertEmpty(ArrayMap<string, string>.Of());
  //   AssertSingle(ArrayMap<string, string>.Of(new KeyValuePair<string, string>("one", "1") });
  //   AssertDouble(ArrayMap<string, string>.Of(new List<KeyValuePair<string, string>> { new KeyValuePair<string, string>("one", "1"), new KeyValuePair<string, string>("two", "2") }), "one", "1", "two", "2");
  //   AssertDouble(ArrayMap<string, string>.Of(new List<KeyValuePair<string, string>> { new KeyValuePair<string, string>("two", "2"), new KeyValuePair<string, string>("one", "1") }), "one", "1", "two", "2");
  // }

  // [Test]
  // public void Multi() {
  //   AssertTriple(
  //       ArrayMap.Empty<string, string>().Plus("1", "one").Plus("2", "two").Plus("3", "three"),
  //       "1", "one", "2", "two", "3", "three");
  //   AssertTriple(
  //       ArrayMap.Empty<string, string>().Plus("2", "two").Plus("3", "three").Plus("1", "one"),
  //       "1", "one", "2", "two", "3", "three");
  //   AssertTriple(
  //       ArrayMap.Empty<string, string>().Plus("3", "three").Plus("1", "one").Plus("2", "two"),
  //       "1", "one", "2", "two", "3", "three");
  // }

  private void AssertEmpty(IDictionary<string, string> map) {
    Assert.That(map.Count, Is.EqualTo(0));
    Assert.IsFalse(map.Keys.Any());
    Assert.IsFalse(map.Values.Any());
    Assert.IsFalse(map.ContainsKey("key"));
    Assert.That(map.FirstOrDefault().Value, Is.EqualTo(default(string)));
  }

  private void AssertSingle(IDictionary<string, string> map, string key, string value) {
    Assert.That(map.Count, Is.EqualTo(1));
    Assert.IsTrue(map.ContainsKey(key));
    Assert.That(map[key], Is.EqualTo(value));
    var singleEntry = new KeyValuePair<string, string>(key, value);
    Assert.IsTrue(map.Contains(singleEntry));
  }

  private void AssertDouble(IDictionary<string, string> map, string key1, string value1, string key2, string value2) {
    Assert.That(map.Count, Is.EqualTo(2));
    Assert.IsTrue(map.ContainsKey(key1));
    Assert.IsTrue(map.ContainsKey(key2));
    Assert.That(map[key1], Is.EqualTo(value1));
    Assert.That(map[key2], Is.EqualTo(value2));
    var entry1 = new KeyValuePair<string, string>(key1, value1);
    var entry2 = new KeyValuePair<string, string>(key2, value2);
    Assert.IsTrue(map.Contains(entry1));
    Assert.IsTrue(map.Contains(entry2));
  }

  private void AssertTriple(IDictionary<string, string> map, string key1, string value1, string key2, string value2, string key3, string value3) {
    Assert.That(map.Count, Is.EqualTo(3));
    Assert.IsTrue(map.ContainsKey(key1));
    Assert.IsTrue(map.ContainsKey(key2));
    Assert.IsTrue(map.ContainsKey(key3));
    Assert.That(map[key1], Is.EqualTo(value1));
    Assert.That(map[key2], Is.EqualTo(value2));
    Assert.That(map[key3], Is.EqualTo(value3));
    var entry1 = new KeyValuePair<string, string>(key1, value1);
    var entry2 = new KeyValuePair<string, string>(key2, value2);
    var entry3 = new KeyValuePair<string, string>(key3, value3);
    Assert.IsTrue(map.Contains(entry1));
    Assert.IsTrue(map.Contains(entry2));
    Assert.IsTrue(map.Contains(entry3));
  }
}

