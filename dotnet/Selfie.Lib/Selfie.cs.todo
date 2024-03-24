// Copyright (C) 2023-2024 DiffPlug
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     https://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
namespace DiffPlug.Selfie.Lib;

using System;
using System.Collections.Generic;
using System.Linq;
using DiffPlug.Selfie.Lib.Guts;

public delegate T Cacheable<out T>();

public static class Selfie {
  internal static readonly SnapshotSystem System = InitSnapshotSystem();
  private static readonly DiskStorage DeferredDiskStorage = new DeferredDiskStorageImpl(System);

  public static void PreserveSelfiesOnDisk(params string[] subsToKeep) {
    var disk = System.DiskThreadLocal();
    if (subsToKeep.Length == 0) {
      disk.Keep(null);
    }
    else {
      foreach (var sub in subsToKeep) {
        disk.Keep(sub);
      }
    }
  }

  public static BinarySelfie ExpectSelfie(byte[] actual) => new(Snapshot.Of(actual), DeferredDiskStorage, "");
  public static StringSelfie ExpectSelfie(string actual) => new(Snapshot.Of(actual), DeferredDiskStorage);
  public static StringSelfie ExpectSelfie(Snapshot actual) => new(actual, DeferredDiskStorage);
  public static LongSelfie ExpectSelfie(long actual) => new(actual);
  public static IntSelfie ExpectSelfie(int actual) => new(actual);
  public static BooleanSelfie ExpectSelfie(bool actual) => new(actual);

  public static StringSelfie ExpectSelfie<T>(T actual, Camera<T> camera) => ExpectSelfie(camera.Snapshot(actual));

  public static CacheSelfie<string> CacheSelfie(Cacheable<string> toCache) =>
      new(DeferredDiskStorage, Roundtrip.Identity<string>(), toCache);

  public static CacheSelfie<T> CacheSelfie<T>(Roundtrip<T, string> roundtrip, Cacheable<T> toCache) =>
      new(DeferredDiskStorage, roundtrip, toCache);

  public static CacheSelfie<T> CacheSelfieJson<T>(Cacheable<T> toCache) => CacheSelfie(RoundtripJson.Of<T>(), toCache);

  public static CacheSelfieBinary<byte[]> CacheSelfieBinary(Cacheable<byte[]> toCache) =>
      new(DeferredDiskStorage, Roundtrip.Identity<byte[]>(), toCache);

  public static CacheSelfieBinary<T> CacheSelfieBinary<T>(Roundtrip<T, byte[]> roundtrip, Cacheable<T> toCache) =>
      new(DeferredDiskStorage, roundtrip, toCache);

  private class DeferredDiskStorageImpl : DiskStorage {
    private readonly SnapshotSystem _system;

    public DeferredDiskStorageImpl(SnapshotSystem system) => _system = system;

    public Snapshot? ReadDisk(string sub, CallStack call) => _system.DiskThreadLocal().ReadDisk(sub, call);

    public void WriteDisk(Snapshot actual, string sub, CallStack call) =>
        _system.DiskThreadLocal().WriteDisk(actual, sub, call);

    public void Keep(string? subOrKeepAll) => _system.DiskThreadLocal().Keep(subOrKeepAll);
  }
}

public abstract class DiskSelfie : FluentFacet {
  protected readonly Snapshot Actual;
  protected readonly DiskStorage Disk;

  protected DiskSelfie(Snapshot actual, DiskStorage disk) {
    Actual = actual;
    Disk = disk;
  }

  public virtual DiskSelfie ToMatchDisk(string sub = "") {
    var call = CallStack.RecordCall(callerFileOnly: false);
    if (Selfie.System.Mode.CanWrite(isTodo: false, call, Selfie.System)) {
      Disk.WriteDisk(Actual, sub, call);
    }
    else {
      AssertEqual(Disk.ReadDisk(sub, call), Actual, Selfie.System);
    }
    return this;
  }

  public virtual DiskSelfie ToMatchDisk_TODO(string sub = "") {
    var call = CallStack.RecordCall(callerFileOnly: false);
    if (Selfie.System.Mode.CanWrite(isTodo: true, call, Selfie.System)) {
      Disk.WriteDisk(Actual, sub, call);
      Selfie.System.WriteInline(TodoStub.ToMatchDisk.CreateLiteral(), call);
      return this;
    }
    else {
      throw Selfie.System.Fs.AssertFailed($"Can't call `ToMatchDisk_TODO` in {Mode.Readonly} mode!");
    }
  }

  public override StringFacet Facet(string facet) => new StringSelfie(Actual, Disk, new[] { facet });
  public override StringFacet Facets(params string[] facets) => new StringSelfie(Actual, Disk, facets);

  public override BinaryFacet FacetBinary(string facet) => new BinarySelfie(Actual, Disk, facet);

  internal static void AssertEqual(Snapshot? expected, Snapshot actual, SnapshotSystem system) {
    if (expected == null) {
      throw system.Fs.AssertFailed(system.Mode.MsgSnapshotNotFound());
    }
    else if (expected != actual) {
      var mismatchedKeys = expected.Facets.Keys.Concat(actual.Facets.Keys)
          .Where(key => !expected.TryGetSubjectOrFacet(key, out var expectedValue) ||
                        !actual.TryGetSubjectOrFacet(key, out var actualValue) ||
                        expectedValue != actualValue)
          .OrderBy(key => key)
          .ToList();

      throw system.Fs.AssertFailed(
          system.Mode.MsgSnapshotMismatch(),
          SerializeOnlyFacets(expected, mismatchedKeys),
          SerializeOnlyFacets(actual, mismatchedKeys));
    }
  }

  private static string SerializeOnlyFacets(Snapshot snapshot, IEnumerable<string> keys) {
    using var writer = new StringWriter();
    foreach (var key in keys) {
      if (snapshot.TryGetSubjectOrFacet(key, out var value)) {
        SnapshotFile.WriteEntry(writer, key == "" ? "" : key, null, value);
      }
    }

    var result = writer.ToString();
    if (result.StartsWith("╔═  ═╗\n")) {
      return result[7..^1];
    }
    else {
      return result[..^1];
    }
  }
}

public class BinarySelfie : DiskSelfie, BinaryFacet {
  private readonly string _onlyFacet;

  public BinarySelfie(Snapshot actual, DiskStorage disk, string onlyFacet)
      : base(actual, disk) {
    _onlyFacet = onlyFacet;

    if (actual.TryGetSubjectOrFacet(_onlyFacet, out var value) && !value.IsBinary) {
      throw new ArgumentException(
          "The facet was not found in the snapshot, or it was not a binary facet.");
    }
  }

  private byte[] ActualBytes() => Actual.GetSubjectOrFacet(_onlyFacet).ValueBinary();

  public override BinarySelfie ToMatchDisk(string sub) {
    base.ToMatchDisk(sub);
    return this;
  }

  public override BinarySelfie ToMatchDisk_TODO(string sub) {
    base.ToMatchDisk_TODO(sub);
    return this;
  }

  public byte[] ToBeBase64_TODO() {
    var actualString = ActualString();
    ToBeDidntMatch(null, actualString, LiteralFormat.String);
    return ActualBytes();
  }

  public byte[] ToBeBase64(string expected) {
    var expectedBytes = Convert.FromBase64String(expected);
    var actualBytes = ActualBytes();

    if (expectedBytes.SequenceEqual(actualBytes)) {
      return Selfie.System.CheckSrc(actualBytes);
    }
    else {
      var actualString = ActualString();
      ToBeDidntMatch(expected, actualString, LiteralFormat.String);
      return actualBytes;
    }
  }

  public byte[] ToBeFile_TODO(string subpath) => ToBeFileImpl(subpath, isTodo: true);

  public byte[] ToBeFile(string subpath) => ToBeFileImpl(subpath, isTodo: false);

  private byte[] ToBeFileImpl(string subpath, bool isTodo) {
    var call = CallStack.RecordCall(callerFileOnly: false);
    var writable = Selfie.System.Mode.CanWrite(isTodo, call, Selfie.System);
    var actualBytes = ActualBytes();

    if (writable) {
      if (isTodo) {
        Selfie.System.WriteInline(TodoStub.ToBeFile.CreateLiteral(), call);
      }
      Selfie.System.WriteToBeFile(ResolvePath(subpath), actualBytes, call);
      return actualBytes;
    }
    else {
      if (isTodo) {
        throw Selfie.System.Fs.AssertFailed(
            $"Can't call `ToBeFile_TODO` in {Mode.Readonly} mode!");
      }
      else {
        var path = ResolvePath(subpath);
        if (!Selfie.System.Fs.FileExists(path)) {
          throw Selfie.System.Fs.AssertFailed(
              Selfie.System.Mode.MsgSnapshotNotFoundNoSuchFile(path));
        }

        var expected = Selfie.System.Fs.FileReadBinary(path);
        if (expected.SequenceEqual(actualBytes)) {
          return actualBytes;
        }
        else {
          throw Selfie.System.Fs.AssertFailed(
              Selfie.System.Mode.MsgSnapshotMismatch(),
              expected,
              actualBytes);
        }
      }
    }
  }

  private string ActualString() => Convert.ToBase64String(ActualBytes());

  private TypedPath ResolvePath(string subpath) =>
      Selfie.System.Layout.RootFolder.ResolveFile(subpath);
}

public class StringSelfie : DiskSelfie, StringFacet {
  private readonly IReadOnlyCollection<string>? _onlyFacets;

  public StringSelfie(Snapshot actual, DiskStorage disk, IReadOnlyCollection<string>? onlyFacets = null)
      : base(actual, disk) {
    _onlyFacets = onlyFacets;

    if (_onlyFacets != null) {
      if (_onlyFacets.Any(facet => facet != "" && !actual.Facets.ContainsKey(facet))) {
        var missing = string.Join(", ", _onlyFacets.Where(f => !actual.Facets.ContainsKey(f)));
        throw new ArgumentException($"The following facets were not found in the snapshot: {missing}");
      }

      if (_onlyFacets.Count == 0) {
        throw new ArgumentException("Must have at least one facet to display.");
      }

      if (_onlyFacets.Contains("") && _onlyFacets.First() != "") {
        throw new ArgumentException(
            "If you specify the subject facet (\"\"), it must be first in the list.");
      }
    }
  }

  public override StringSelfie ToMatchDisk(string sub) {
    base.ToMatchDisk(sub);
    return this;
  }

  public override StringSelfie ToMatchDisk_TODO(string sub) {
    base.ToMatchDisk_TODO(sub);
    return this;
  }

  private string ActualString() {
    if (Actual.Facets.Count == 0 || _onlyFacets?.Count == 1) {
      var onlyValue = Actual.GetSubjectOrFacet(_onlyFacets?.FirstOrDefault() ?? "");
      return onlyValue.IsBinary
          ? Convert.ToBase64String(onlyValue.ValueBinary())
          : onlyValue.ValueString();
    }
    else {
      return SerializeOnlyFacets(Actual, _onlyFacets ?? Actual.Facets.Keys.Prepend("").ToList());
    }
  }

  public string ToBe_TODO() {
    var actualString = ActualString();
    return ToBeDidntMatch(null, actualString, LiteralFormat.String);
  }

  public string ToBe(string expected) {
    var actualString = ActualString();
    return actualString == expected
        ? Selfie.System.CheckSrc(actualString)
        : ToBeDidntMatch(expected, actualString, LiteralFormat.String);
  }

  private static string SerializeOnlyFacets(Snapshot snapshot, IEnumerable<string> keys) {
    using var writer = new StringWriter();
    foreach (var key in keys) {
      if (snapshot.TryGetSubjectOrFacet(key, out var value)) {
        SnapshotFile.WriteEntry(writer, key == "" ? "" : key, null, value);
      }
    }

    var result = writer.ToString();
    if (result.StartsWith("╔═  ═╗\n")) {
      return result[7..^1];
    }
    else {
      return result[..^1];
    }
  }
}

internal static class Extensions {
  public static T CheckSrc<T>(this SnapshotSystem system, T value) {
    system.Mode.CanWrite(isTodo: false, CallStack.RecordCall(callerFileOnly: true), system);
    return value;
  }

  public static string ToBeDidntMatch<T>(T? expected, T actual, LiteralFormat<T> format) where T : notnull {
    var call = CallStack.RecordCall(callerFileOnly: false);
    var writable = Selfie.System.Mode.CanWrite(expected == null, call, Selfie.System);

    if (writable) {
      Selfie.System.WriteInline(new LiteralValue<T>(expected, actual, format), call);
      return actual.ToString()!;
    }
    else {
      if (expected == null) {
        throw Selfie.System.Fs.AssertFailed($"Can't call ToBe_TODO in {Mode.Readonly} mode!");
      }
      else {
        throw Selfie.System.Fs.AssertFailed(
        Selfie.System.Mode.MsgSnapshotMismatch(),
        expected,
        actual);
      }
    }
  }
}

public class IntSelfie {
  private readonly int _actual;

  public IntSelfie(int actual) => _actual = actual;

  public int ToBe_TODO() => Extensions.ToBeDidntMatch(null, _actual, LiteralFormat.Int);

  public int ToBe(int expected) =>
      _actual == expected
          ? Selfie.System.CheckSrc(_actual)
          : Extensions.ToBeDidntMatch(expected, _actual, LiteralFormat.Int);

}

public class LongSelfie {
  private readonly long _actual;

  public LongSelfie(long actual) => _actual = actual;

  public long ToBe_TODO() => Extensions.ToBeDidntMatch(null, _actual, LiteralFormat.Long);

  public long ToBe(long expected) =>
      _actual == expected
          ? Selfie.System.CheckSrc(_actual)
          : Extensions.ToBeDidntMatch(expected, _actual, LiteralFormat.Long);

}

public class BooleanSelfie {
  private readonly bool _actual;

  public BooleanSelfie(bool actual) => _actual = actual;

  public bool ToBe_TODO() => Extensions.ToBeDidntMatch(null, _actual, LiteralFormat.Boolean);

  public bool ToBe(bool expected) =>
      _actual == expected
          ? Selfie.System.CheckSrc(_actual)
          : Extensions.ToBeDidntMatch(expected, _actual, LiteralFormat.Boolean);

}

public class CacheSelfie<T> {
  private readonly DiskStorage _disk;
  private readonly Roundtrip<T, string> _roundtrip;
  private readonly Cacheable<T> _generator;

  public CacheSelfie(DiskStorage disk, Roundtrip<T, string> roundtrip, Cacheable<T> generator) {
    _disk = disk;
    _roundtrip = roundtrip;
    _generator = generator;
  }

  public T ToMatchDisk(string sub = "") => ToMatchDiskImpl(sub, isTodo: false);

  public T ToMatchDisk_TODO(string sub = "") => ToMatchDiskImpl(sub, isTodo: true);

  private T ToMatchDiskImpl(string sub, bool isTodo) {
    var call = CallStack.RecordCall(callerFileOnly: false);
    if (Selfie.System.Mode.CanWrite(isTodo, call, Selfie.System)) {
      var actual = _generator();
      _disk.WriteDisk(Snapshot.Of(_roundtrip.Serialize(actual)), sub, call);
      if (isTodo) {
        Selfie.System.WriteInline(TodoStub.ToMatchDisk.CreateLiteral(), call);
      }
      return actual;
    }
    else {
      if (isTodo) {
        throw Selfie.System.Fs.AssertFailed(
            $"Can't call `ToMatchDisk_TODO` in {Mode.Readonly} mode!");
      }
      else {
        var snapshot = _disk.ReadDisk(sub, call);
        if (snapshot == null) {
          throw Selfie.System.Fs.AssertFailed(Selfie.System.Mode.MsgSnapshotNotFound());
        }

        if (snapshot.Subject.IsBinary || snapshot.Facets.Count > 0) {
          throw Selfie.System.Fs.AssertFailed(
              $"Expected a string subject with no facets, got {snapshot}");
        }
        return _roundtrip.Parse(snapshot.Subject.ValueString());
      }
    }
  }

  public T ToBe_TODO() => ToBeImpl(null);

  public T ToBe(string expected) => ToBeImpl(expected);

  private T ToBeImpl(string? snapshot) {
    var call = CallStack.RecordCall(callerFileOnly: false);
    var writable = Selfie.System.Mode.CanWrite(snapshot == null, call, Selfie.System);

    if (writable) {
      var actual = _generator();
      Selfie.System.WriteInline(new LiteralValue<string>(snapshot, _roundtrip.Serialize(actual), LiteralFormat.String), call);
      return actual;
    }
    else {
      if (snapshot == null) {
        throw Selfie.System.Fs.AssertFailed($"Can't call `ToBe_TODO` in {Mode.Readonly} mode!");
      }
      else {
        return _roundtrip.Parse(snapshot);
      }
    }
  }

}

public class CacheSelfieBinary<T> {
  private readonly DiskStorage _disk;
  private readonly Roundtrip<T, byte[]> _roundtrip;

  private readonly Cacheable<T> _generator;

  public CacheSelfieBinary(DiskStorage disk, Roundtrip<T, byte[]> roundtrip, Cacheable<T> generator) {
    _disk = disk;
    _roundtrip = roundtrip;
    _generator = generator;
  }

  public T ToMatchDisk(string sub = "") => ToMatchDiskImpl(sub, isTodo: false);

  public T ToMatchDisk_TODO(string sub = "") => ToMatchDiskImpl(sub, isTodo: true);

  private T ToMatchDiskImpl(string sub, bool isTodo) {
    var call = CallStack.RecordCall(callerFileOnly: false);
    if (Selfie.System.Mode.CanWrite(isTodo, call, Selfie.System)) {
      var actual = _generator();
      _disk.WriteDisk(Snapshot.Of(_roundtrip.Serialize(actual)), sub, call);
      if (isTodo) {
        Selfie.System.WriteInline(TodoStub.ToMatchDisk.CreateLiteral(), call);
      }
      return actual;
    }
    else {
      if (isTodo) {
        throw Selfie.System.Fs.AssertFailed($"Can't call `ToMatchDisk_TODO` in {Mode.Readonly} mode!");
      }
      else {
        var snapshot = _disk.ReadDisk(sub, call);
        if (snapshot == null) {
          throw Selfie.System.Fs.AssertFailed(Selfie.System.Mode.MsgSnapshotNotFound());
        }

        if (!snapshot.Subject.IsBinary || snapshot.Facets.Count > 0) {
          throw Selfie.System.Fs.AssertFailed($"Expected a binary subject with no facets, got {snapshot}");
        }
        return _roundtrip.Parse(snapshot.Subject.ValueBinary());
      }
    }
  }

  public T ToBeFile_TODO(string subpath) => ToBeFileImpl(subpath, isTodo: true);

  public T ToBeFile(string subpath) => ToBeFileImpl(subpath, isTodo: false);

  private T ToBeFileImpl(string subpath, bool isTodo) {
    var call = CallStack.RecordCall(callerFileOnly: false);
    var writable = Selfie.System.Mode.CanWrite(isTodo, call, Selfie.System);

    if (writable) {
      var actual = _generator();
      if (isTodo) {
        Selfie.System.WriteInline(TodoStub.ToBeFile.CreateLiteral(), call);
      }
      Selfie.System.WriteToBeFile(ResolvePath(subpath), _roundtrip.Serialize(actual), call);
      return actual;
    }
    else {
      if (isTodo) {
        throw Selfie.System.Fs.AssertFailed($"Can't call `ToBeFile_TODO` in {Mode.Readonly} mode!");
      }
      else {
        var path = ResolvePath(subpath);
        if (!Selfie.System.Fs.FileExists(path)) {
          throw Selfie.System.Fs.AssertFailed(Selfie.System.Mode.MsgSnapshotNotFoundNoSuchFile(path));
        }
        return _roundtrip.Parse(Selfie.System.Fs.FileReadBinary(path));
      }
    }
  }

  public T ToBeBase64_TODO() => ToBeBase64Impl(null);

  public T ToBeBase64(string expected) => ToBeBase64Impl(expected);

  private T ToBeBase64Impl(string? snapshot) {
    var call = CallStack.RecordCall(callerFileOnly: false);
    var writable = Selfie.System.Mode.CanWrite(snapshot == null, call, Selfie.System);

    if (writable) {
      var actual = _generator();
      var base64 = Convert.ToBase64String(_roundtrip.Serialize(actual));
      Selfie.System.WriteInline(new LiteralValue<string>(snapshot, base64, LiteralFormat.String), call);
      return actual;
    }
    else {
      if (snapshot == null) {
        throw Selfie.System.Fs.AssertFailed($"Can't call `ToBeBase64_TODO` in {Mode.Readonly} mode!");
      }
      else {
        return _roundtrip.Parse(Convert.FromBase64String(snapshot));
      }
    }
  }

  private TypedPath ResolvePath(string subpath) =>
      Selfie.System.Layout.RootFolder.ResolveFile(subpath);

}

public static class SelfieBinarySerializableExtensions {
  public static CacheSelfieBinary<T> CacheSelfieBinarySerializable<T>(this Selfie _, Cacheable<T> toCache)
  where T : ISerializable =>
  Selfie.CacheSelfieBinary(SerializableRoundtrip<T>.Instance, toCache);
}

internal class SerializableRoundtrip<T> : Roundtrip<T, byte[]> where T : ISerializable {
  public static readonly SerializableRoundtrip<T> Instance = new();

  public override byte[] Serialize(T value) {
    using var stream = new MemoryStream();
    var formatter = new BinaryFormatter();
    formatter.Serialize(stream, value);
    return stream.ToArray();
  }

  public override T Parse(byte[] serialized) {
    using var stream = new MemoryStream(serialized);
    var formatter = new BinaryFormatter();
    return (T)formatter.Deserialize(stream);
  }
}
