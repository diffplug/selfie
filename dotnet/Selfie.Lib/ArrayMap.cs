using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace DiffPlug.Selfie.Lib;

public abstract class ListBackedSet<T> : ISet<T> {
  public abstract T this[int index] { get; }
  public abstract int Count { get; }
  public bool IsReadOnly => false;

  public IEnumerator<T> GetEnumerator() {
    for (var i = 0; i < Count; i++) {
      yield return this[i];
    }
  }

  IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

  public bool Contains(T item) => IndexOf(item) >= 0;

  public void CopyTo(T[] array, int arrayIndex) {
    for (var i = 0; i < Count; i++) {
      array[arrayIndex + i] = this[i];
    }
  }

  public bool Add(T item) => throw new NotSupportedException();
  public void Clear() => throw new NotSupportedException();
  public bool Remove(T item) => throw new NotSupportedException();

  public void ExceptWith(IEnumerable<T> other) => throw new NotSupportedException();
  public void IntersectWith(IEnumerable<T> other) => throw new NotSupportedException();
  public void SymmetricExceptWith(IEnumerable<T> other) => throw new NotSupportedException();
  public void UnionWith(IEnumerable<T> other) => throw new NotSupportedException();

  public int IndexOf(T item) {
    var comparer = GetComparer(item);
    for (var i = 0; i < Count; i++) {
      if (comparer.Compare(this[i], item) == 0) {
        return i;
      }
    }
    return -1;
  }

  public bool IsProperSubsetOf(IEnumerable<T> other) {
    var otherSet = new HashSet<T>(other);
    return Count < otherSet.Count && IsSubsetOf(otherSet);
  }

  public bool IsProperSupersetOf(IEnumerable<T> other) {
    var otherSet = new HashSet<T>(other);
    return Count > otherSet.Count && otherSet.IsSubsetOf(this);
  }

  public bool IsSubsetOf(IEnumerable<T> other) {
    var otherSet = new HashSet<T>(other);
    return this.All(item => otherSet.Contains(item));
  }

  public bool IsSupersetOf(IEnumerable<T> other) {
    var otherSet = new HashSet<T>(other);
    return otherSet.IsSubsetOf(this);
  }

  public bool Overlaps(IEnumerable<T> other) {
    return other.Any(Contains);
  }

  public bool SetEquals(IEnumerable<T> other) {
    var otherSet = new HashSet<T>(other);
    return Count == otherSet.Count && IsSubsetOf(otherSet);
  }

  void ICollection<T>.Add(T item) => Add(item);

  private static IComparer<T> GetComparer(T element) =>
      typeof(T) == typeof(string) ? (IComparer<T>)new StringComparer() : Comparer<T>.Default;

  private class StringComparer : IComparer<string> {
    public int Compare(string? x, string? y) => CompareStringsWithSlashFirst(x, y);
  }

  protected static int CompareStringsWithSlashFirst(string? a, string? b) {
    if (a == b) {
      return 0;
    }

    if (a == null) {
      return -1;
    }

    if (b == null) {
      return 1;
    }

    var length = Math.Min(a.Length, b.Length);
    for (var i = 0; i < length; i++) {
      var charA = a[i];
      var charB = b[i];
      if (charA != charB) {
        return charA == '/' ? -1 :
               charB == '/' ? 1 :
               charA.CompareTo(charB);
      }
    }
    return a.Length.CompareTo(b.Length);
  }
}

public class ArrayMap<TKey, TValue> : IDictionary<TKey, TValue>
    where TKey : notnull, IComparable<TKey> {
  private readonly object[] _data;

  private ArrayMap(object[] data) {
    _data = data;
  }

  public ArrayMap<TKey, TValue> MinusSortedIndices(IReadOnlyList<int> indicesToRemove) {
    if (indicesToRemove.Count == 0) {
      return this;
    }

    var newData = new object[_data.Length - indicesToRemove.Count * 2];
    var newDataIdx = 0;
    var oldDataIdx = 0;
    var removeIdx = 0;

    while (oldDataIdx < _data.Length / 2) {
      if (removeIdx < indicesToRemove.Count && oldDataIdx == indicesToRemove[removeIdx]) {
        removeIdx++;
      }
      else {
        if (newDataIdx >= newData.Length) {
          throw new ArgumentException(
              $"The indices weren't sorted or were >= Count ({Count}): {string.Join(", ", indicesToRemove)}");
        }
        newData[newDataIdx++] = _data[oldDataIdx * 2];
        newData[newDataIdx++] = _data[oldDataIdx * 2 + 1];
      }
      oldDataIdx++;
    }

    if (removeIdx != indicesToRemove.Count) {
      throw new ArgumentException(
          $"The indices weren't sorted or were >= Count ({Count}): {string.Join(", ", indicesToRemove)}");
    }

    return new ArrayMap<TKey, TValue>(newData);
  }

  public ArrayMap<TKey, TValue> Plus(TKey key, TValue value) {
    var next = PlusOrNoOp(key, value);
    if (next == this) {
      throw new ArgumentException($"Key already exists: {key}");
    }
    return next;
  }

  public ArrayMap<TKey, TValue> PlusOrNoOp(TKey key, TValue value) {
    var index = KeysList.IndexOf(key);
    return index >= 0 ? this : Insert(~index, key, value);
  }

  public ArrayMap<TKey, TValue> PlusOrNoOpOrReplace(TKey key, TValue newValue) {
    var index = KeysList.IndexOf(key);
    if (index >= 0) {
      var existingValue = _data[index * 2 + 1];
      return existingValue == null && newValue == null || existingValue?.Equals(newValue) == true
          ? this
          : ReplaceValue(index, newValue);
    }
    else {
      return Insert(~index, key, newValue);
    }
  }

  private ArrayMap<TKey, TValue> Insert(int index, TKey key, TValue value) {
    switch (_data.Length) {
      case 0:
        return new ArrayMap<TKey, TValue>(new object[] { key!, value! });
      case 1:
        return index == 0
            ? new ArrayMap<TKey, TValue>(new object[] { key!, value!, _data[0]!, _data[1]! })
            : new ArrayMap<TKey, TValue>(new object[] { _data[0]!, _data[1]!, key!, value! });
      default: {
          var pairs = new KeyValuePair<TKey, TValue>[Count + 1];
          for (var i = 0; i < index; i++) {
            pairs[i] = new KeyValuePair<TKey, TValue>((TKey)_data[i * 2]!, (TValue)_data[i * 2 + 1]!);
          }
          pairs[index] = new KeyValuePair<TKey, TValue>(key, value);
          for (var i = index + 1; i < pairs.Length; i++) {
            pairs[i] = new KeyValuePair<TKey, TValue>((TKey)_data[(i - 1) * 2]!, (TValue)_data[(i - 1) * 2 + 1]!);
          }
          return Of(pairs.ToArray());
        }
    }
  }

  private ArrayMap<TKey, TValue> ReplaceValue(int index, TValue newValue) {
    var copy = new object[_data.Length];
    Array.Copy(_data, copy, _data.Length);
    copy[index * 2 + 1] = newValue!;
    return new ArrayMap<TKey, TValue>(copy);
  }


  public ListBackedSet<TKey> KeysList => new ArrayMapKeySet(_data);
  public ICollection<TKey> Keys => KeysList;
  public ICollection<TValue> Values => new ArrayMapValueCollection(_data);

  public int Count => _data.Length / 2;
  public bool IsReadOnly => true;

  public TValue this[TKey key] {
    get {
      var index = KeysList.IndexOf(key);
      return index >= 0 ? (TValue)_data[index * 2 + 1]! : throw new KeyNotFoundException(key.ToString());
    }
    set => throw new NotSupportedException();
  }

  public bool ContainsKey(TKey key) => KeysList.IndexOf(key) >= 0;
  public bool TryGetValue(TKey key, out TValue value) {
    var index = KeysList.IndexOf(key);
    if (index >= 0) {
      value = (TValue)_data[index * 2 + 1]!;
      return true;
    }
    else {
      value = default!;
      return false;
    }
  }

  public void Add(TKey key, TValue value) => throw new NotSupportedException();
  public bool Remove(TKey key) => throw new NotSupportedException();
  public void Clear() => throw new NotSupportedException();
  public void Add(KeyValuePair<TKey, TValue> item) => throw new NotSupportedException();

  public bool Remove(KeyValuePair<TKey, TValue> item) => throw new NotSupportedException();

  public IEnumerator<KeyValuePair<TKey, TValue>> GetEnumerator() {
    for (var i = 0; i < Count; i++) {
      yield return new KeyValuePair<TKey, TValue>((TKey)_data[i * 2]!, (TValue)_data[i * 2 + 1]!);
    }
  }

  IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

  public void CopyTo(KeyValuePair<TKey, TValue>[] array, int arrayIndex) {
    for (var i = 0; i < Count; i++) {
      array[arrayIndex + i] = new KeyValuePair<TKey, TValue>((TKey)_data[i * 2]!, (TValue)_data[i * 2 + 1]!);
    }
  }

  public bool Contains(KeyValuePair<TKey, TValue> item) =>
      TryGetValue(item.Key, out var value) &&
      (value == null && item.Value == null || value?.Equals(item.Value) == true);

  public override bool Equals(object? obj) =>
      obj is ArrayMap<TKey, TValue> other && Equals(other);

  public bool Equals(ArrayMap<TKey, TValue>? other) {
    if (other == null || Count != other.Count) {
      return false;
    }

    for (var i = 0; i < Count; i++) {
      if (!Equals(_data[i * 2], other._data[i * 2]) ||
          !Equals(_data[i * 2 + 1], other._data[i * 2 + 1])) {
        return false;
      }
    }
    return true;
  }

  public override int GetHashCode() {
    var hash = 0;
    for (var i = 0; i < _data.Length; i++) {
      hash ^= _data[i]?.GetHashCode() ?? 0;
    }
    return hash;
  }

  public override string ToString() =>
      $"[{string.Join(", ", this.Select(kv => $"{kv.Key}={kv.Value}"))}]";

  private class ArrayMapKeySet : ListBackedSet<TKey> {
    private readonly object[] _data;

    public ArrayMapKeySet(object[] data) {
      _data = data;
    }

    public override TKey this[int index] => (TKey)_data[index * 2]!;
    public override int Count => _data.Length / 2;
  }

  private class ArrayMapValueCollection : ICollection<TValue> {
    private readonly object[] _data;

    public ArrayMapValueCollection(object[] data) {
      _data = data;
    }

    public int Count => _data.Length / 2;
    public bool IsReadOnly => true;

    public IEnumerator<TValue> GetEnumerator() {
      for (var i = 1; i < _data.Length; i += 2) {
        yield return (TValue)_data[i]!;
      }
    }

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    public bool Contains(TValue item) {
      for (var i = 1; i < _data.Length; i += 2) {
        var value = (TValue)_data[i]!;
        if (value == null && item == null || value?.Equals(item) == true) {
          return true;
        }
      }
      return false;
    }

    public void CopyTo(TValue[] array, int arrayIndex) {
      for (var i = 1; i < _data.Length; i += 2) {
        array[arrayIndex++] = (TValue)_data[i]!;
      }
    }

    public void Add(TValue item) => throw new NotSupportedException();
    public bool Remove(TValue item) => throw new NotSupportedException();
    public void Clear() => throw new NotSupportedException();
  }

  private static readonly ArrayMap<TKey, TValue> EmptyImpl =
      new(Array.Empty<object>());

  public static ArrayMap<TKey, TValue> Empty { get; } = EmptyImpl;

  public static ArrayMap<TKey, TValue> Of(params KeyValuePair<TKey, TValue>[] pairs) {
    if (pairs.Length <= 1) {
      return pairs.Length == 0 ? Empty : new ArrayMap<TKey, TValue>(new object[] { pairs[0].Key!, pairs[0].Value! });
    }

    Array.Sort(pairs, PairComparer.Instance);

    var data = new object[pairs.Length * 2];
    for (var i = 0; i < pairs.Length; i++) {
      data[i * 2] = pairs[i].Key!;
      data[i * 2 + 1] = pairs[i].Value!;
    }
    return new ArrayMap<TKey, TValue>(data);
  }

  private class PairComparer : IComparer<KeyValuePair<TKey, TValue>> {
    public static readonly PairComparer Instance = new();
    public int Compare(KeyValuePair<TKey, TValue> x, KeyValuePair<TKey, TValue> y) => x.Key.CompareTo(y.Key);
  }
}
