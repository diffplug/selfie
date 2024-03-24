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
namespace DiffPlug.Selfie.Lib.Guts;

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal record CallLocation(string Class, string Method, string? FileName, int Line) : IComparable<CallLocation> {
  public CallLocation WithLine(int line) => this with { Line = line };
  public bool SamePathAs(CallLocation other) => Class == other.Class && FileName == other.FileName;
  public int CompareTo(CallLocation? other) =>
      other == null ? 1 :
      Class.CompareTo(other.Class).CombineComparison(
          Method.CompareTo(other.Method),
          FileName?.CompareTo(other.FileName) ?? 0,
          Line.CompareTo(other.Line));

  public string FindFileIfAbsent(SnapshotFileLayout layout) =>
      FileName ?? layout.SourcePathForCallMaybe(this)?.Name ?? $"{Class.Split('.')[^1]}.class";

  public string IdeLink(SnapshotFileLayout layout) =>
      $"{Class}.{Method}({FindFileIfAbsent(layout)}:{Line})";
  public string SourceFilenameWithoutExtension() => Class.Split('.', '$')[^1];
}

internal static class CallStack {
  public static CallStack RecordCall(bool callerFileOnly) =>
      new StackTrace().GetFrames()
          ?.SkipWhile(f => f.GetMethod()?.DeclaringType?.FullName?.StartsWith("DiffPlug.Selfie.Lib") == true)
          .Select(frame => new CallLocation(
              frame.GetMethod()!.DeclaringType!.FullName!,
              callerFileOnly ? "<unknown>" : frame.GetMethod()!.Name,
              frame.GetFileName(),
              callerFileOnly ? -1 : frame.GetFileLineNumber()))
          .ToArray() is { Length: > 1 } frames
      ? new CallStack(frames[0], frames[1..])
      : new CallStack(new CallLocation("<unknown>", "<unknown>", null, -1), Array.Empty<CallLocation>());
}

internal readonly record struct CallStack(CallLocation Location, IReadOnlyList<CallLocation> RestOfStack) {
  public string IdeLink(SnapshotFileLayout layout) =>
      string.Join(Environment.NewLine,
          Enumerable.Repeat(Location, 1)
              .Concat(RestOfStack)
              .Select(location => location.IdeLink(layout)));
}

internal record FirstWrite<T>(T Snapshot, CallStack CallStack);

internal abstract class WriteTracker<TKey, TValue> : IEqualityComparer<TKey>
    where TKey : notnull, IEquatable<TKey> {
  private readonly ThreadLocal<ArrayMap<TKey, FirstWrite<TValue>>> _writes = new(true);

  public bool Equals(TKey? x, TKey? y) => x?.Equals(y) == true;
  public int GetHashCode([DisallowNull] TKey obj) => obj.GetHashCode();

  protected void RecordInternal(TKey key, TValue snapshot, CallStack call, SnapshotFileLayout layout) {
    var thisWrite = new FirstWrite<TValue>(snapshot, call);
    var newMap = _writes.Value!.PutIfAbsent(key, thisWrite, this);

    if (newMap == _writes.Value) {
      // we were the first write
      _writes.Value = newMap;
      return;
    }

    // we were not the first write 
    var existing = newMap[key];
    layout.CheckForSmuggledError();
    string howToFix = this switch {
      DiskWriteTracker => "You can fix this with `.ToMatchDisk(string sub)` and pass a unique value for sub.",
      InlineWriteTracker => """
                    You can fix this by doing an `if` before the assertion to separate the cases, e.g.
if (isWindows) {
expectSelfie(underTest).ToBe("C:\")
} else {
expectSelfie(underTest).ToBe("bash$")
}
""",
      ToBeFileWriteTracker => "You can fix this with .ToBeFile(string filename) and pass a unique filename for each code path.",
      _ => throw new ArgumentOutOfRangeException()
    };
    if (!Equals(existing.Snapshot, snapshot)) {
      throw layout.Fs.AssertFailed(
          $"""
            Snapshot was set to multiple values!
              first time: {existing.CallStack.Location.IdeLink(layout)}
               this time: {call.Location.IdeLink(layout)}
            {howToFix}
            """,
          existing.Snapshot,
          snapshot);
    }
    else if (!layout.AllowMultipleEquivalentWritesToOneLocation) {
      throw layout.Fs.AssertFailed(
          $"""
            Snapshot was set to the same value multiple times.
            {howToFix}
            """,
          existing.CallStack.IdeLink(layout),
          call.IdeLink(layout));
    }
  }
  the cases, e.g.
if (isWindows) {
expectSelfie(underTest).ToBe("C:\")
} else {
expectSelfie(underTest).ToBe("bash$")
}
""",
ToBeFileWriteTracker => "You can fix this with .ToBeFile(string filename) and pass a unique filename for each code path.",
_ => throw new ArgumentOutOfRangeException()
};


Copy code
    if (!Equals(existing.Snapshot, snapshot))
    {
        throw layout.Fs.AssertFailed(
            $"""
            Snapshot was set to multiple values!
              first time: {existing.CallStack.Location.IdeLink(layout)}
               this time: {call.Location.IdeLink(layout)}
            {howToFix}
            """,
            existing.Snapshot,
            snapshot);
    }
    else if (!layout.AllowMultipleEquivalentWritesToOneLocation) {
  throw layout.Fs.AssertFailed(
      $"""
            Snapshot was set to the same value multiple times.
            {howToFix}
            """,
      existing.CallStack.IdeLink(layout),
      call.IdeLink(layout));
}
}
}

internal class DiskWriteTracker : WriteTracker<string, Snapshot> {
  public void Record(string key, Snapshot snapshot, CallStack call, SnapshotFileLayout layout) =>
  RecordInternal(key, snapshot, call, layout);
}

internal class ToBeFileWriteTracker : WriteTracker<TypedPath, ToBeFileLazyBytes> {
  public void WriteToDisk(TypedPath key, byte[] snapshot, CallStack call, SnapshotFileLayout layout) {
    var lazyBytes = new ToBeFileLazyBytes(key, layout, snapshot);
    RecordInternal(key, lazyBytes, call, layout);
    lazyBytes.WriteToDisk();
  }
}

internal class ToBeFileLazyBytes : IEquatable<ToBeFileLazyBytes> {
  private readonly TypedPath _location;
  private readonly SnapshotFileLayout _layout;
  private byte[]? _data;

  public ToBeFileLazyBytes(TypedPath location, SnapshotFileLayout layout, byte[] data) {
    _location = location;
    _layout = layout;
    _data = data;
  }

  internal void WriteToDisk() {
    if (_data == null) {
      throw new InvalidOperationException("Data has already been written to disk!");
    }

    _layout.Fs.FileWriteBinary(_location, _data);
    _data = null;
  }

  private byte[] ReadData() => _data ?? _layout.Fs.FileReadBinary(_location);

  public bool Equals(ToBeFileLazyBytes? other) =>
      other != null && ReadData().SequenceEqual(other.ReadData());

  public override bool Equals(object? obj) => Equals(obj as ToBeFileLazyBytes);
  public override int GetHashCode() => ReadData().GetHashCode();

}

internal enum EscapeLeadingWhitespace {
  Always,
  Never,
  OnlyOnSpace,
  OnlyOnTab
}

internal static class EscapeLeadingWhitespaceExtensions {
  public static string EscapeLine(this EscapeLeadingWhitespace policy, string line) =>
  policy switch {
    EscapeLeadingWhitespace.Always =>
  line[0] switch {
    ' ' => $"\s{line[1..]}",
    '\t' => $"\t{line[1..]}",
    _ => line
  },
    EscapeLeadingWhitespace.Never => line,
    EscapeLeadingWhitespace.OnlyOnSpace => line[0] == ' ' ? $"\s{line[1..]}" : line,
    EscapeLeadingWhitespace.OnlyOnTab => line[0] == '\t' ? $"\t{line[1..]}" : line,
    _ => throw new ArgumentOutOfRangeException(nameof(policy), policy, null)
  };

  public static EscapeLeadingWhitespace AppropriateFor(string fileContent) =>
      fileContent.AsLines()
          .Select(line => line.TakeWhile(char.IsWhiteSpace))
          .Where(ws => ws.Any())
          .Aggregate(EscapeLeadingWhitespace.Never, (current, ws) =>
              ws.All(c => c == ' ') ? EscapeLeadingWhitespace.OnlyOnTab :
              ws.All(c => c == '\t') ? EscapeLeadingWhitespace.OnlyOnSpace :
              EscapeLeadingWhitespace.Always);

}

internal class InlineWriteTracker : WriteTracker<CallLocation, LiteralValue> {
  public void Record(CallStack call, LiteralValue literalValue, SnapshotFileLayout layout) {
    RecordInternal(call.Location, literalValue, call, layout);

    var file = layout.SourcePathForCall(call.Location)!;
    if (literalValue.Expected != null) {
      var content = new SourceFile(file.Name, layout.Fs.FileRead(file));
      var parsedValue = content.ParseToBeLike(call.Location.Line).ParseLiteral(literalValue.Format);

      if (!Equals(parsedValue, literalValue.Expected)) {
        throw layout.Fs.AssertFailed(
            $"""
                Selfie cannot modify the literal at {call.Location.IdeLink(layout)} because Selfie has a parsing bug. 
                Please report this error at https://github.com/diffplug/selfie
                """,
            literalValue.Expected,
            parsedValue);
      }
    }
  }

  public bool HasWrites() => !_writes.Value!.IsEmpty;

  private record FileLineLiteral(TypedPath File, int Line, LiteralValue Literal) : IComparable<FileLineLiteral> {
    public int CompareTo(FileLineLiteral? other) =>
        other == null ? 1 :
        File.CompareTo(other.File).CombineComparison(Line.CompareTo(other.Line));
  }

  public void PersistWrites(SnapshotFileLayout layout) {
    var writes = _writes.Value!
        .Select(kvp => new FileLineLiteral(
            layout.SourcePathForCall(kvp.Key)!,
            kvp.Key.Line,
            kvp.Value.Snapshot))
        .OrderBy(x => x)
        .ToList();

    if (!writes.Any()) {
      return;
    }

    var (file, content, _) = writes[0];
    var deltaLineNumbers = 0;

    foreach (var write in writes) {
      if (write.File != file) {
        layout.Fs.FileWrite(file, content.ToString());
        (file, content, deltaLineNumbers) = (write.File, new SourceFile(write.File.Name, layout.Fs.FileRead(write.File)), 0);
      }

      var line = write.Line + deltaLineNumbers;
      if (write.Literal.Format == LiteralFormat.TodoStub) {
        var kind = (TodoStub)write.Literal.Actual;
        content = content.ReplaceOnLine(line, $".{kind.Name}_TODO(", $".{kind.Name}(");
      }
      else {
        deltaLineNumbers += content.ParseToBeLike(line).SetLiteralAndGetNewlineDelta(write.Literal);
      }
    }

    layout.Fs.FileWrite(file, content.ToString());
  }

}

internal enum TodoStub { ToMatchDisk, ToBeFile }

internal static class TodoStubExtensions {
  public static LiteralValue CreateLiteral(this TodoStub stub) =>
  new(null, stub, LiteralFormat.TodoStub);
}

internal sealed class ReentrantLock {
  private readonly object _lock = new();
  private int _lockCount;
  private int _owningThreadId;

  public void Lock() {
    var currentThreadId = Environment.CurrentManagedThreadId;

    lock (_lock) {
      if (_owningThreadId == currentThreadId) {
        _lockCount++;
      }
      else {
        while (_lockCount > 0) {
          Monitor.Wait(_lock);
        }

        _owningThreadId = currentThreadId;
        _lockCount = 1;
      }
    }
  }

  public void Unlock() {
    lock (_lock) {
      if (_owningThreadId != Environment.CurrentManagedThreadId) {
        throw new InvalidOperationException("Thread does not own the lock");
      }

      _lockCount--;

      if (_lockCount == 0) {
        _owningThreadId = 0;
        Monitor.PulseAll(_lock);
      }
    }
  }
}

internal static class ReentrantLockExtensions {
  public static T WithLock<T>(this ReentrantLock @lock, Func<T> block) {
    @lock.Lock();
    try {
      return block();
    }
    finally {
      @lock.Unlock();
    }
  }
  public static void WithLock(this ReentrantLock @lock, Action block) =>
      @lock.WithLock(() => { block(); return 0; });
}

internal class CommentTracker {
  private enum WritableComment { NoComment, Once, Forever }
  private readonly ThreadLocal<ArrayMap<TypedPath, WritableComment>> _cache = new(true);

  public IEnumerable<TypedPath> PathsWithOnce() =>
      _cache.Value!.Where(kvp => kvp.Value == WritableComment.Once).Select(kvp => kvp.Key);

  public bool HasWritableComment(CallStack call, SnapshotFileLayout layout) {
    var path = layout.SourcePathForCall(call.Location)!;
    var (comment, _) = CommentAndLine(path, layout.Fs);
    var writable = comment switch {
      WritableComment.NoComment => false,
      WritableComment.Once => true,
      WritableComment.Forever => true,
      _ => throw new ArgumentOutOfRangeException(nameof(comment), comment, null)
    };
    _cache.Value = _cache.Value!.Put(path, comment, EqualityComparer<TypedPath>.Default);
    return writable;
  }

  public static (string Comment, int Line) CommentString(TypedPath path, IFs fs) {
    var (comment, line) = CommentAndLine(path, fs);
    return comment switch {
      WritableComment.NoComment => throw new InvalidOperationException(),
      WritableComment.Once => ("//selfieonce", line),
      WritableComment.Forever => ("//SELFIEWRITE", line),
      _ => throw new ArgumentOutOfRangeException(nameof(comment), comment, null)
    };
  }

  private static (WritableComment Comment, int Line) CommentAndLine(TypedPath path, IFs fs) {
    var content = fs.FileRead(path);

    foreach (var prefix in new[] { "//selfieonce", "// selfieonce", "//SELFIEWRITE", "// SELFIEWRITE" }) {
      var index = content.IndexOf(prefix, StringComparison.Ordinal);
      if (index != -1) {
        var lineNumber = content.Substring(0, index).AsLines().Count();
        var comment = prefix.Contains("once") ? WritableComment.Once : WritableComment.Forever;
        return (comment, lineNumber);
      }
    }

    return (WritableComment.NoComment, -1);
  }

}

internal class SourcePathCache {
  private readonly ReentrantLock _lock = new();
  private readonly ThreadLocal<LruCache<CallLocation, TypedPath?>> _backingCache;

  public SourcePathCache(Func<CallLocation, TypedPath?> pathResolver, int capacity) =>
      _backingCache = new(() => new LruCache<CallLocation, TypedPath?>(capacity,
          (a, b) => a.SamePathAs(b), loc => pathResolver(loc).GetHashCode()));

  public TypedPath? Get(CallLocation key) {
    _lock.WithLock(() => {
      var path = _backingCache.Value![key];
      if (path != null) {
        return path;
      }

      path = _backingCache.Value!.GetValueFactory()(key);
      _backingCache.Value = _backingCache.Value!.Put(key, path);
      return path;
    });
    return null;
  }

}

internal static class JreVersion {
  public static int Get() {
    var versionStr = Environment.Version.ToString();
    if (versionStr.StartsWith("1.")) {
      if (versionStr.StartsWith("1.8")) {
        return 8;
      }
      throw new Exception($"Unsupported .NET version: {versionStr}");
    }
    else {
      return int.Parse(versionStr.Split('.')[0]);
    }
  }
}

internal enum Language {
  Java,
  JavaPre15,
  Kotlin,
  Groovy,
  Scala,
  CSharp,
  FSharp,
  VbNet
}

internal static class LanguageExtensions {
  public static Language FromFilename(string filename) =>
  Path.GetExtension(filename).ToLowerInvariant() switch {
    ".java" => JreVersion.Get() < 15 ? Language.JavaPre15 : Language.Java,
    ".kt" => Language.Kotlin,
    ".groovy" or ".gvy" or ".gy" => Language.Groovy,
    ".scala" or ".sc" => Language.Scala,

    ".cs" => Language.CSharp,
    ".fs" or ".fsx" => Language.FSharp,
    ".vb" => Language.VbNet,
    _ => throw new ArgumentException($"Unknown language for file {filename}", nameof(filename))
  };
}

internal record LiteralValue(object? Expected, object Actual, ILiteralFormat Format);

internal interface ILiteralFormat {
  string Encode(object value, Language language, EscapeLeadingWhitespace encodingPolicy);
  object Parse(string str, Language language);
  Type TargetType { get; }
}

internal abstract record LiteralFormat<T>() : ILiteralFormat where T : notnull {
  public Type TargetType => typeof(T);
  protected abstract string EncodeCore(T value, Language language, EscapeLeadingWhitespace encodingPolicy);
  protected abstract T ParseCore(string str, Language language);

  public string Encode(object value, Language language, EscapeLeadingWhitespace encodingPolicy) =>
      EncodeCore((T)value, language, encodingPolicy);

  public object Parse(string str, Language language) => ParseCore(str, language);

}

internal sealed record LiteralFormat : ILiteralFormat {
  public static readonly LiteralFormat Int = new(EncodeInt, int.Parse, typeof(int));
  public static readonly LiteralFormat Long = new(EncodeLong, long.Parse, typeof(long));
  public static readonly LiteralFormat String = new(EncodeString, ParseString, typeof(string));
  public static readonly LiteralFormat Boolean = new(bool.ToString, bool.Parse, typeof(bool));
  public static readonly LiteralFormat TodoStub = new((_, _, _) => throw new InvalidOperationException(), str => throw new InvalidOperationException(), typeof(TodoStub));

  private readonly Func<object, Language, EscapeLeadingWhitespace, string> _encoder;
  private readonly Func<string, Language, object> _parser;

  private LiteralFormat(
      Func<object, Language, EscapeLeadingWhitespace, string> encoder,
      Func<string, Language, object> parser,
      Type targetType) {
    _encoder = encoder;
    _parser = parser;
    TargetType = targetType;
  }

  public string Encode(object value, Language language, EscapeLeadingWhitespace encodingPolicy) =>
      _encoder(value, language, encodingPolicy);

  public object Parse(string str, Language language) => _parser(str, language);
  public Type TargetType { get; }

  private const int MaxRawNumber = 1000;
  private const int PaddingSize = 2;

  private static string EncodeInt(object value, Language _, EscapeLeadingWhitespace _2) =>
      EncodeUnderscores((int)value);

  private static string EncodeLong(object value, Language _, EscapeLeadingWhitespace _2) =>
      $"{EncodeUnderscores((long)value)}L";

  private static string EncodeUnderscores(long value) {
    var sb = new StringBuilder();
    void Encode(long num) {
      if (num >= MaxRawNumber) {
        var mod = num % MaxRawNumber;
        var leftPadding = PaddingSize - mod.ToString().Length;
        Encode(num / MaxRawNumber);
        sb.Append('_');
        sb.Append('0', leftPadding);
        sb.Append(mod);
      }
      else if (num < 0) {
        sb.Append('-');
        Encode(Math.Abs(num));
      }
      else {
        sb.Append(num);
      }
    }
    Encode(value);
    return sb.ToString();
  }

  private static string EncodeString(object value, Language language, EscapeLeadingWhitespace encodingPolicy) =>
      ((string)value).Contains('\n')
          ? language switch {
            Language.Scala or Language.Groovy or Language.JavaPre15 => EncodeSingleJava((string)value),
            Language.Java => EncodeMultiJava((string)value, encodingPolicy),
            Language.Kotlin => EncodeMultiKotlin((string)value, encodingPolicy),
            Language.CSharp => EncodeMultiCSharp((string)value, encodingPolicy),
            Language.FSharp => EncodeMultiFSharp((string)value, encodingPolicy),
            Language.VbNet => EncodeMultiVbNet((string)value, encodingPolicy),
            _ => throw new ArgumentOutOfRangeException(nameof(language), language, null)
          }
          : language switch {
            Language.Scala or Language.JavaPre15 or Language.Groovy or Language.Java => EncodeSingleJava((string)value),
            Language.Kotlin => EncodeSingleJavaWithDollars((string)value),
            Language.CSharp => EncodeSingleCSharp((string)value),
            Language.FSharp => EncodeSingleFSharp((string)value),
            Language.VbNet => EncodeSingleVbNet((string)value),
            _ => throw new ArgumentOutOfRangeException(nameof(language), language, null)
          };

  private static string EncodeSingleJava(string value) => EncodeSingleJavaish(value, escapeDollars: false);
  private static string EncodeSingleJavaWithDollars(string value) => EncodeSingleJavaish(value, escapeDollars: true);

  private static string EncodeSingleJavaish(string value, bool escapeDollars) {
    var sb = new StringBuilder();
    sb.Append('"');
    foreach (var c in value) {
      switch (c) {
        case '\b':
          sb.Append("\\b");
          break;
        case '\n':
          sb.Append("\\n");
          break;
        case '\r':
          sb.Append("\\r");
          break;
        case '\t':
          sb.Append("\\t");
          break;
        case '\"':
          sb.Append("\\\"");
          break;
        case '\\':
          sb.Append("\\\\");
          break;
        case '$' when escapeDollars:
          sb.Append("\\'\\$\\'");
          break;
        default:
          if (char.IsControl(c)) {
            sb.Append("\\u");
            sb.Append(((int)c).ToString("X4"));
          }
          else {
            sb.Append(c);
          }
          break;
      }
    }
    sb.Append('"');
    return sb.ToString();
  }

  private static string EncodeMultiJava(string value, EscapeLeadingWhitespace encodingPolicy) {
    var lines = UnescapeJava(value.Replace("\\", "\\\\").Replace("\"\"\"", "\\\"\\\"\\\""))
        .Split('\n')
        .Select(line => {
          var trimmedLine = line.TrimEnd();
          return trimmedLine.EndsWith(" ")
              ? $"{trimmedLine[..^1]}\\s"
              : trimmedLine.EndsWith("\t")
                  ? $"{trimmedLine[..^1]}\\t"
                  : trimmedLine;
        })
        .ToArray();

    var commonIndent = lines
        .Where(line => !string.IsNullOrWhiteSpace(line))
        .Select(line => new string(line.TakeWhile(char.IsWhiteSpace).ToArray()))
        .MinBy(indent => indent.Length);

    if (!string.IsNullOrEmpty(commonIndent)) {
      lines = lines
          .Select((line, i) => i == lines.Length - 1
              ? line[..commonIndent.Length] switch {
                "" => line,
                var indent => $"\\s{line[indent.Length..]}",
              }
              : line[commonIndent.Length..])
          .ToArray();
    }

    var encoded = string.Join(Environment.NewLine,
        lines.Select(line => encodingPolicy.EscapeLine(line)));

    return $"\"\"\"\\n{encoded}\"\"\"";
  }

  private static string EncodeMultiKotlin(string arg, EscapeLeadingWhitespace encodingPolicy) {
    var lines = arg
        .Replace("$", "\\'\\$\\'")
        .Replace("\"\"\"", "\\$\\$\\$")
        .Split('\n')
        .Select(line => {
          var trimmedLine = line.TrimEnd();
          return trimmedLine.EndsWith(" ")
              ? $"{trimmedLine[..^1]}${{' '}}"
              : trimmedLine.EndsWith("\t")
                  ? $"{trimmedLine[..^1]}${{'\\t'}}"
                  : trimmedLine;
        })
        .Select(line => encodingPolicy.EscapeLine(line))
        .ToArray();

    return $"\"\"\"{string.Join(Environment.NewLine, lines)}\"\"\"";
  }

  private static string EncodeMultiCSharp(string arg, EscapeLeadingWhitespace encodingPolicy) {
    var lines = arg
        .Replace("\"", "\"\"")
        .Split('\n')
        .Select(line => {
          var trimmedLine = line.TrimEnd();
          return trimmedLine.EndsWith(" ")
              ? $"{trimmedLine[..^1]}{{' '}}"
              : trimmedLine.EndsWith("\t")
                  ? $"{trimmedLine[..^1]}{{'\\t'}}"
                  : trimmedLine;
        })
        .Select(line => encodingPolicy.EscapeLine(line))
        .ToArray();

    return $"@\"{string.Join(Environment.NewLine, lines)}\"";
  }

  private static string EncodeMultiFSharp(string arg, EscapeLeadingWhitespace encodingPolicy) {
    var lines = arg
        .Replace("\"\"", "\"\\\"\"")
        .Split('\n')
        .Select(line => {
          var trimmedLine = line.TrimEnd();
          return trimmedLine.EndsWith(" ")
              ? $"{trimmedLine[..^1]}{{' '}}"
              : trimmedLine.EndsWith("\t")
                  ? $"{trimmedLine[..^1]}{{'\\t'}}"
                  : trimmedLine;
        })
        .Select(line => encodingPolicy.EscapeLine(line))
        .ToArray();

    return $"@\"\"\"{string.Join(Environment.NewLine, lines)}\"\"\"";
  }

  private static string EncodeMultiVbNet(string arg, EscapeLeadingWhitespace encodingPolicy) {
    var lines = arg
        .Replace("\"", "\"\"")
        .Split('\n')
        .Select(line => {
          var trimmedLine = line.TrimEnd();
          return trimmedLine.EndsWith(" ")
              ? $"{trimmedLine[..^1]} "
              : trimmedLine.EndsWith("\t")
                  ? $"{trimmedLine[..^1]}{{vbTab}}"
                  : trimmedLine;
        })
        .Select(line => encodingPolicy.EscapeLine(line))
        .ToArray();

    return $"@\"{string.Join(Environment.NewLine, lines)}\"";
  }

  private static string EncodeSingleCSharp(string value) =>
      $"\"{value.Replace("\"", "\\\"")}\"";

  private static string EncodeSingleFSharp(string value) =>
      $"\"{value.Replace("\"", "\\\"")}\"";

  private static string EncodeSingleVbNet(string value) =>
      $"\"{value.Replace("\"", "\"\"")}\"";

  private static string ParseString(string str, Language language) {
    if (!str.StartsWith("\"\"\"")) {
      return language switch {
        Language.Scala or Language.JavaPre15 or Language.Java => ParseSingleJava(str),
        Language.Groovy or Language.Kotlin => ParseSingleJavaWithDollars(str),
        Language.CSharp => ParseSingleCSharp(str),
        Language.FSharp => ParseSingleFSharp(str),
        Language.VbNet => ParseSingleVbNet(str),
        _ => throw new ArgumentOutOfRangeException(nameof(language), language, null)
      };
    }
    else {
      return language switch {
        Language.Scala => throw new NotSupportedException("Scala multiline strings are not yet supported"),
        Language.Groovy => throw new NotSupportedException("Groovy multiline strings are not yet supported"),
        Language.JavaPre15 or Language.Java => ParseMultiJava(str),
        Language.Kotlin => ParseMultiKotlin(str),
        Language.CSharp => ParseMultiCSharp(str),
        Language.FSharp => ParseMultiFSharp(str),
        Language.VbNet => ParseMultiVbNet(str),
        _ => throw new ArgumentOutOfRangeException(nameof(language), language, null)
      };
    }
  }

  private static string ParseSingleJava(string str) => ParseSingleJavaish(str, removeDollars: false);
  private static string ParseSingleJavaWithDollars(string str) => ParseSingleJavaish(str, removeDollars: true);

  private static string ParseSingleJavaish(string str, bool removeDollars) {
    if (!str.StartsWith("\"") || !str.EndsWith("\"")) {
      throw new ArgumentException("String must start and end with double quotes", nameof(str));
    }

    var unquoted = str[1..^1];
    var toUnescape = removeDollars ? InlineDollars(unquoted) : unquoted;
    return UnescapeJava(toUnescape);
  }

  private static string ParseMultiJava(string str) {
    if (!str.StartsWith("\"\"\"\\n") || !str.EndsWith("\"\"\"")) {
      throw new ArgumentException("Invalid multiline Java string literal", nameof(str));
    }

    var unquoted = str[5..^3];
    var lines = unquoted.Split(new[] { '\\', 'n' }, StringSplitOptions.RemoveEmptyEntries);

    var commonIndent = lines
        .Where(line => !string.IsNullOrWhiteSpace(line))
        .Select(line => new string(line.TakeWhile(char.IsWhiteSpace).ToArray()))
        .MinBy(x => x.Length);

    return string.Join(Environment.NewLine,
        lines.Select(line => line.StartsWith(commonIndent) ? line[commonIndent.Length..] : line));
  }

  private static string ParseMultiKotlin(string str) {
    if (!str.StartsWith("\"\"\"") || !str.EndsWith("\"\"\"")) {
      throw new ArgumentException("Invalid multiline Kotlin string literal", nameof(str));
    }

    var unquoted = str[3..^3];
    return InlineDollars(unquoted);
  }

  private static string ParseMultiCSharp(string str) {
    if (!str.StartsWith("@\"") || !str.EndsWith("\"")) {
      throw new ArgumentException("Invalid multiline C# string literal", nameof(str));
    }

    return str[2..^1].Replace("\"\"", "\"");
  }

  private static string ParseMultiFSharp(string str) {
    if (!str.StartsWith("@\"\"\"") || !str.EndsWith("\"\"\"")) {
      throw new ArgumentException("Invalid multiline F# string literal", nameof(str));
    }

    return str[4..^3].Replace("\\\"\\\"", "\"");
  }

  private static string ParseMultiVbNet(string str) {
    if (!str.StartsWith("@\"") || !str.EndsWith("\"")) {
      throw new ArgumentException("Invalid multiline VB.NET string literal", nameof(str));
    }

    return str[2..^1].Replace("\"\"", "\"").Replace("{{vbTab}}", "\t");
  }

  private static string ParseSingleCSharp(string str) {
    if (!str.StartsWith("\"") || !str.EndsWith("\"")) {
      throw new ArgumentException("Invalid C# string literal", nameof(str));
    }

    return str[1..^1].Replace("\\\"", "\"");
  }

  private static string ParseSingleFSharp(string str) {
    if (!str.StartsWith("\"") || !str.EndsWith("\"")) {
      throw new ArgumentException("Invalid F# string literal", nameof(str));
    }

    return str[1..^1].Replace("\\\"", "\"");
  }

  private static string ParseSingleVbNet(string str) {
    if (!str.StartsWith("\"") || !str.EndsWith("\"")) {
      throw new ArgumentException("Invalid VB.NET string literal", nameof(str));
    }

    return str[1..^1].Replace("""", """);
}

  private static readonly Regex CharLiteralRegex = new(@"\$\{'(\\?.)'\}", RegexOptions.Compiled);

  private static string InlineDollars(string str) {
    return CharLiteralRegex.Replace(str, match => {
      var charLiteral = match.Groups[1].Value;
      return charLiteral switch {
        ['\\', var c] => c switch {
          't' => "\t",
          'b' => "\b",
          'n' => "\n",
          'r' => "\r",
          '\'' => "'",
          '\\' => "\\",
          '$' => "$",
          _ => charLiteral
        },
        [var c] => c.ToString(),
        _ => throw new ArgumentException($"Invalid character literal: {charLiteral}", nameof(str))
      };
    });
  }

  private static string UnescapeJava(string str) {
    var sb = new StringBuilder();
    for (var i = 0; i < str.Length; i++) {
      var c = str[i];
      if (c == '\\') {
        i++;
        if (i == str.Length) {
          throw new ArgumentException("Invalid escape sequence at end of string", nameof(str));
        }

        c = str[i];
        sb.Append(c switch {
          '"' => '"',
          '\\' => '\\',
          'b' => '\b',
          'f' => '\f',
          'n' => '\n',
          'r' => '\r',
          't' => '\t',
          'u' => (char)Convert.ToUInt16(str.Substring(i + 1, 4), 16),
          _ => throw new ArgumentException($"Invalid escape sequence: \\{c}", nameof(str))
        });

        if (c == 'u') {
          i += 4;
        }
      }
      else {
        sb.Append(c);
      }
    }
    return sb.ToString();
  }

}

internal class WithinTestGC {
  private readonly ThreadLocal<ArraySet<string>?> _suffixesToKeep = new(true);

  public void KeepSuffix(string suffix) =>
      _suffixesToKeep.Value = _suffixesToKeep.Value!.PlusOrThis(suffix);

  public WithinTestGC KeepAll() {
    _suffixesToKeep.Value = null;
    return this;
  }

  public override string ToString() => _suffixesToKeep.Value?.ToString() ?? "(null)";

  public bool SucceededAndUsedNoSnapshots() => _suffixesToKeep.Value == ArraySet<string>.Empty;

  private bool Keeps(string sub) => _suffixesToKeep.Value?.Contains(sub) != false;

  public static IReadOnlyList<int> FindStaleSnapshotsWithin(
      ArrayMap<string, Snapshot> snapshots,
      ArrayMap<string, WithinTestGC> testsThatRan) {
    var staleIndices = new List<int>();

    var gcRoots = testsThatRan.OrderBy(e => e.Key).ToArray();
    var keys = snapshots.Keys.ToArray();
    var gcIdx = 0;
    var keyIdx = 0;

    while (keyIdx < keys.Length && gcIdx < gcRoots.Length) {
      var key = keys[keyIdx];
      var gc = gcRoots[gcIdx];

      if (key.StartsWith(gc.Key)) {
        if (key.Length == gc.Key.Length) {
          // exact match, no suffix
          if (!gc.Value.Keeps("")) {
            staleIndices.Add(keyIdx);
          }
          keyIdx++;
        }
        else if (key[gc.Key.Length] == '/') {
          // key is longer and next char is '/', so it's a suffix
          var suffix = key[gc.Key.Length..];
          if (!gc.Value.Keeps(suffix)) {
            staleIndices.Add(keyIdx);
          }
          keyIdx++;
        }
        else {
          // key is longer but not a suffix, so increment gc  
          gcIdx++;
        }
      }
      else {
        // key doesn't start with gc prefix
        if (string.CompareOrdinal(gc.Key, key) < 0) {
          gcIdx++; // gc is behind, catch it up  
        }
        else {
          // gc is ahead, so this key is stale
          staleIndices.Add(keyIdx);
          keyIdx++;
        }
      }
    }

    while (keyIdx < keys.Length) {
      staleIndices.Add(keyIdx);
      keyIdx++;
    }

    return staleIndices;
  }

}

internal record TypedPath(string AbsolutePath) : IEquatable<TypedPath>, IComparable<TypedPath> {
  public bool Equals(TypedPath? other) =>
  other != null && string.Equals(AbsolutePath, other.AbsolutePath, StringComparison.Ordinal);

  public override int GetHashCode() => AbsolutePath.GetHashCode();

  public int CompareTo(TypedPath? other) =>
      other == null ? 1 : string.Compare(AbsolutePath, other.AbsolutePath, StringComparison.Ordinal);

  public string Name => Path.GetFileName(AbsolutePath);

  public bool IsFolder => AbsolutePath.EndsWith("/", StringComparison.Ordinal);

  private void AssertFolder() {
    if (!IsFolder) {
      throw new InvalidOperationException(
          $"Expected {this} to be a folder but it doesn't end with '/'");
    }
  }

  public TypedPath ParentFolder() {
    var lastSlash = AbsolutePath.LastIndexOf('/');
    if (lastSlash == -1) {
      throw new InvalidOperationException($"{this} does not have a parent folder");
    }
    return OfFolder(AbsolutePath[..lastSlash] + "/");
  }

  public TypedPath ResolveFile(string child) {
    AssertFolder();
    if (child.StartsWith("/", StringComparison.Ordinal)) {
      throw new ArgumentException("Child must not start with '/'", nameof(child));
    }
    if (child.EndsWith("/", StringComparison.Ordinal)) {
      throw new ArgumentException("Child must not end with '/'", nameof(child));
    }
    return OfFile(AbsolutePath + child);
  }

  public TypedPath ResolveFolder(string child) {
    AssertFolder();
    if (child.StartsWith("/", StringComparison.Ordinal)) {
      throw new ArgumentException("Child must not start with '/'", nameof(child));
    }
    return OfFolder(AbsolutePath + child);
  }

  public string Relativize(TypedPath child) {
    AssertFolder();
    if (!child.AbsolutePath.StartsWith(AbsolutePath, StringComparison.Ordinal)) {
      throw new ArgumentException($"Expected {child} to start with {AbsolutePath}");
    }
    return child.AbsolutePath[AbsolutePath.Length..];
  }

  public static TypedPath OfFolder(string path) {
    var unixPath = path.Replace("\\", "/");
    return new TypedPath(unixPath.EndsWith("/", StringComparison.Ordinal)
        ? unixPath
        : unixPath + "/");
  }

  public static TypedPath OfFile(string path) {
    var unixPath = path.Replace("\\", "/");
    if (unixPath.EndsWith("/", StringComparison.Ordinal)) {
      throw new ArgumentException("File path must not end with '/'", nameof(path));
    }
    return new TypedPath(unixPath);
  }

}

internal interface IFs {
  bool FileExists(TypedPath path);
  T FileWalk<T>(TypedPath start, Func<IEnumerable<TypedPath>, T> walk);
  string FileRead(TypedPath path);
  byte[] FileReadBinary(TypedPath path);

  void FileWrite(TypedPath path, string content);
  void FileWriteBinary(TypedPath path, byte[] content);
  Exception AssertFailed(string message, object? expected = null, object? actual = null);
}

internal interface ISnapshotSystem {
  IFs Fs { get; }
  Mode Mode { get; }
  SnapshotFileLayout Layout { get; }
  bool SourceFileHasWritableComment(CallStack call);
  void WriteInline(LiteralValue value, CallStack call);
  void WriteToBeFile(TypedPath path, byte[] data, CallStack call);
  DiskStorage DiskThreadLocal();
}

internal interface DiskStorage {
  Snapshot? ReadDisk(string sub, CallStack call);
  void WriteDisk(Snapshot actual, string sub, CallStack call);
  void Keep(string? subOrKeepAll);
}

internal static class SnapshotSystemInitializer {
  public static ISnapshotSystem InitStorage() {
    var placesToLook = new[]
    {
"DiffPlug.Selfie.Lib.JUnit.SnapshotSystemJUnit5",
"DiffPlug.Selfie.Lib.Kotest.SnapshotSystemKotest",
// Add any other test frameworks here
};


    var implementations = placesToLook
            .Select(t => Type.GetType(t, throwOnError: false))
            .Where(t => t != null)
            .ToArray();

    if (implementations.Length > 1) {
      throw new InvalidOperationException(
          $"Found multiple ISnapshotSystem implementations: {string.Join(", ", implementations)}\n" +
          "Only one test framework integration should be used at a time.");
    }

    if (implementations.Length == 0) {
      throw new InvalidOperationException(
          "Missing required test framework integration. Add a reference to one of:\n" +
          " - DiffPlug.Selfie.JUnit5\n" +
          " - DiffPlug.Selfie.Kotest");
    }

    var initMethod = implementations[0]!.GetMethod("InitStorage");
    if (initMethod?.IsStatic != true || initMethod.ReturnType != typeof(ISnapshotSystem)) {
      throw new InvalidOperationException(
          $"ISnapshotSystem implementation {implementations[0]} does not have a valid InitStorage method");
    }

    return (ISnapshotSystem)initMethod.Invoke(null, Array.Empty<object>())!;
  }

}

internal interface SnapshotFileLayout {
  TypedPath RootFolder { get; }
  IFs Fs { get; }
  bool AllowMultipleEquivalentWritesToOneLocation { get; }
  TypedPath SourcePathForCall(CallLocation call);
  TypedPath? SourcePathForCallMaybe(CallLocation call);
  void CheckForSmuggledError();
}

internal class SourceFile {
  private readonly bool _unixNewlines;
  private Slice _contentSlice;
  private readonly Language _language;
  private readonly EscapeLeadingWhitespace _escapeLeadingWhitespace;

  public SourceFile(string filename, string content) {
    _unixNewlines = !content.Contains("\r");
    _contentSlice = new Slice(content.Replace("\r\n", "\n"));
    _language = LanguageExtensions.FromFilename(filename);
    _escapeLeadingWhitespace = EscapeLeadingWhitespaceExtensions.AppropriateFor(_contentSlice.ToString());
  }

  public string AsString =>
      _unixNewlines ? _contentSlice.ToString() : _contentSlice.ToString().Replace("\n", "\r\n");

  public class ToBeLiteral {
    private readonly SourceFile _parent;
    private readonly string _dotFunOpenParen;
    private readonly Slice _functionCallPlusArg;
    private readonly Slice _arg;

    internal ToBeLiteral(SourceFile parent, string dotFunOpenParen, Slice functionCallPlusArg, Slice arg) {
      _parent = parent;
      _dotFunOpenParen = dotFunOpenParen;
      _functionCallPlusArg = functionCallPlusArg;
      _arg = arg;
    }

    public int SetLiteralAndGetNewlineDelta<T>(LiteralValue<T> literalValue) where T : notnull {
      var encoded = literalValue.Format.EncodeCore(literalValue.Actual, _parent._language, _parent._escapeLeadingWhitespace);
      var roundTripped = literalValue.Format.ParseCore(encoded, _parent._language);
      if (!EqualityComparer<T>.Default.Equals(roundTripped, literalValue.Actual)) {
        throw new InvalidOperationException(
            $"There is an error in {literalValue.Format.GetType().Name}, the following value isn't round tripping.\n" +
            "Please report this issue at https://github.com/diffplug/selfie/issues/new\n" +
            "```\n" +
            "ORIGINAL\n" +
            $"{literalValue.Actual}\n" +
            "ROUNDTRIPPED\n" +
            $"{roundTripped}\n" +
            "ENCODED ORIGINAL\n" +
            $"{encoded}\n" +
            "```\n");
      }

      var existingNewlines = _functionCallPlusArg.Count(c => c == '\n');
      var newNewlines = encoded.Count(c => c == '\n');
      _parent._contentSlice = new Slice(_functionCallPlusArg.ReplaceWith($"{_dotFunOpenParen}{encoded})"));
      return newNewlines - existingNewlines;
    }

    public T ParseLiteral<T>(LiteralFormat<T> literalFormat) where T : notnull {
      return literalFormat.ParseCore(_arg.ToString(), _parent._language);
    }
  }

  public void RemoveSelfieOnceComments() {
    _contentSlice = new Slice(
        _contentSlice.ToString().Replace("//selfieonce", "").Replace("// selfieonce", ""));
  }

  private Slice FindOnLine(string toFind, int lineOneIndexed) {
    var lineContent = _contentSlice.GetLine(lineOneIndexed);
    var idx = lineContent.IndexOf(toFind);
    if (idx == -1) {
      throw new AssertionException($"Expected to find `{toFind}` on line {lineOneIndexed}, but there was only `{lineContent}`");
    }
    return lineContent.Slice(idx, idx + toFind.Length);
  }

  public void ReplaceOnLine(int lineOneIndexed, string find, string replace) {
    if (find.IndexOf('\n') != -1) {
      throw new ArgumentException("Find string cannot contain newlines", nameof(find));
    }
    if (replace.IndexOf('\n') != -1) {
      throw new ArgumentException("Replace string cannot contain newlines", nameof(replace));
    }

    var slice = FindOnLine(find, lineOneIndexed);
    _contentSlice = new Slice(slice.ReplaceWith(replace));
  }

  public ToBeLiteral ParseToBeLike(int lineOneIndexed) {
    var lineContent = _contentSlice.GetLine(lineOneIndexed);
    var toBeLikes = new[] { ".toBe(", ".toBe_TODO(", ".toBeBase64(", ".toBeBase64_TODO(" };
    var dotFunOpenParen = toBeLikes.FirstOrDefault(toBelike => lineContent.Contains(toBelike));

    if (dotFunOpenParen == null) {
      throw new AssertionException($"Expected to find inline assertion on line {lineOneIndexed}, but there was only `{lineContent}`");
    }

    var dotFunctionCallInPlace = lineContent.IndexOf(dotFunOpenParen);
    var dotFunctionCall = dotFunctionCallInPlace + lineContent.Start;
    var argStart = dotFunctionCall + dotFunOpenParen.Length;

    if (argStart == _contentSlice.Length) {
      throw new AssertionException($"Appears to be an unclosed function call `{dotFunOpenParen})` on line {lineOneIndexed}");
    }

    while (char.IsWhiteSpace(_contentSlice[argStart])) {
      argStart++;
      if (argStart == _contentSlice.Length) {
        throw new AssertionException($"Appears to be an unclosed function call `{dotFunOpenParen})` on line {lineOneIndexed}");
      }
    }

    var endArg = -1;
    var endParen = -1;
    if (_contentSlice[argStart] == '"') {
      if (_contentSlice.Slice(argStart).StartsWith("\"\"\"")) {
        endArg = _contentSlice.IndexOf("\"\"\"", argStart + 3);
        if (endArg == -1) {
          throw new AssertionException($"Appears to be an unclosed multiline string literal `\"\"\"` on line {lineOneIndexed}");
        }
        else {
          endArg += 3;
          endParen = endArg;
        }
      }
      else {
        endArg = argStart + 1;
        while (_contentSlice[endArg] != '"' || _contentSlice[endArg - 1] == '\\') {
          endArg++;
          if (endArg == _contentSlice.Length) {
            throw new AssertionException($"Appears to be an unclosed string literal `\"` on line {lineOneIndexed}");
          }
        }
        endArg++;
        endParen = endArg;
      }
    }
    else {
      endArg = argStart;
      while (!char.IsWhiteSpace(_contentSlice[endArg])) {
        if (_contentSlice[endArg] == ')') {
          break;
        }
        endArg++;
        if (endArg == _contentSlice.Length) {
          throw new AssertionException($"Appears to be an unclosed numeric literal on line {lineOneIndexed}");
        }
      }
      endParen = endArg;
    }

    while (_contentSlice[endParen] != ')') {
      if (!char.IsWhiteSpace(_contentSlice[endParen])) {
        throw new AssertionException(
            $"Non-primitive literal in `{dotFunOpenParen})` starting at line {lineOneIndexed}: " +
            $"error for character `{_contentSlice[endParen]}` on line {_contentSlice.GetLineNumber(endParen)}");
      }
      endParen++;
      if (endParen == _contentSlice.Length) {
        throw new AssertionException($"Appears to be an unclosed function call `{dotFunOpenParen})` starting at line {lineOneIndexed}");
      }
    }

    return new ToBeLiteral(
        this,
        dotFunOpenParen.Replace("_TODO", ""),
        _contentSlice.Slice(dotFunctionCall, endParen + 1),
        _contentSlice.Slice(argStart, endArg));
  }
}

internal class Slice {
  private readonly string _base;
  private readonly int _start;
  private readonly int _end;

  public Slice(string @base, int start = 0, int end = -1) {
    if (start < 0) {
      throw new ArgumentOutOfRangeException(nameof(start), "Start index cannot be negative");
    }
    if (end < start && end != -1) {
      throw new ArgumentOutOfRangeException(nameof(end), "End index cannot be less than start index");
    }
    if (end > @base.Length) {
      throw new ArgumentOutOfRangeException(nameof(end), "End index cannot be greater than base string length");
    }

    _base = @base;
    _start = start;
    _end = end == -1 ? @base.Length : end;
  }

  public int Length => _end - _start;
  public int Start => _start;
  public int End => _end;
  public char this[int index] => _base[_start + index];

  public Slice Slice(int start, int end = -1) =>
      new(_base, _start + start, end == -1 ? _end : _start + end);

  public Slice Trim() {
    var start = _start;
    var end = _end;
    while (start < end && char.IsWhiteSpace(_base[start])) {
      start++;
    }
    while (end > start && char.IsWhiteSpace(_base[end - 1])) {
      end--;
    }
    return start == _start && end == _end ? this : Slice(start - _start, end - _start);
  }

  public override string ToString() => _base.Substring(_start, Length);

  public bool SameAs(string other) => ToString() == other;

  public int IndexOf(char c, int startOffset = 0) {
    var index = _base.IndexOf(c, _start + startOffset, Length - startOffset);
    return index == -1 ? -1 : index - _start;
  }

  public int IndexOf(string str, int startOffset = 0) {
    var index = _base.IndexOf(str, _start + startOffset, Length - startOffset, StringComparison.Ordinal);
    return index == -1 ? -1 : index - _start;
  }

  public bool StartsWith(string str) =>
      Length >= str.Length && _base.IndexOf(str, _start, str.Length) == _start;

  public bool Contains(string str) => IndexOf(str) != -1;

  public int Count(Func<char, bool> predicate) => Enumerable.Range(0, Length).Count(i => predicate(this[i]));

  public Slice GetLine(int lineNumber) {
    if (lineNumber <= 0) {
      throw new ArgumentOutOfRangeException(nameof(lineNumber), "Line number must be positive");
    }

    var start = _start;
    for (var i = 1; i < lineNumber; i++) {
      start = _base.IndexOf('\n', start);
      if (start == -1 || start >= _end) {
        throw new ArgumentException($"This string has only {i - 1} lines, not {lineNumber}", nameof(lineNumber));
      }
      start++;
    }

    var end = _base.IndexOf('\n', start);
    if (end == -1 || end > _end) {
      end = _end;
    }

    return new Slice(_base, start, end);
  }

  public int GetLineNumber(int globalOffset) {
    var offset = globalOffset - _start;
    if (offset < 0 || offset >= Length) {
      throw new ArgumentOutOfRangeException(nameof(globalOffset), "Offset is outside the bounds of this slice");
    }
    return _base.Substring(0, _start + offset).Count(c => c == '\n') + 1;
  }

  public string ReplaceWith(string str) {
    var sb = new StringBuilder(_base.Length + str.Length - Length);
    sb.Append(_base, 0, _start)
      .Append(str)
      .Append(_base, _end, _base.Length - _end);
    return sb.ToString();
  }

  public override bool Equals(object? obj) =>
      obj is Slice slice && SameAs(slice.ToString());

  public override int GetHashCode() {
    var hash = new HashCode();
    for (var i = 0; i < Length; i++) {
      hash.Add(this[i]);
    }
    return hash.ToHashCode();
  }

}

internal record CoroutineDiskStorage(DiskStorage Disk) : IThreadLocalDiskStorage;

internal interface IThreadLocalDiskStorage {
  DiskStorage Disk { get; }
}
