using System;
using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("Selfie.Lib.Tests")]

namespace DiffPlug.Selfie.Lib.Guts;
internal class Slice {
  private string Base { get; }
  private int StartIndex { get; }
  private int EndIndex { get; }

  public Slice(string @base, int startIndex = 0, int endIndex = -1) {
    Base = @base;
    StartIndex = startIndex;
    EndIndex = endIndex == -1 ? @base.Length : endIndex;

    if (StartIndex < 0 || StartIndex > EndIndex || EndIndex > Base.Length) {
      throw new ArgumentOutOfRangeException(nameof(startIndex), "Start and end indices must be within the base string's bounds.");
    }
  }

  public int Length => EndIndex - StartIndex;

  public char this[int index] => Base[StartIndex + index];

  public Slice SubSequence(int start, int end) {
    return new Slice(Base, StartIndex + start, StartIndex + end);
  }

  public Slice Trim() {
    int start = 0, end = Length;
    while (start < end && char.IsWhiteSpace(this[start])) start++;
    while (start < end && char.IsWhiteSpace(this[end - 1])) end--;

    return start > 0 || end < Length ? SubSequence(start, end) : this;
  }

  public override string ToString() {
    return Base.Substring(StartIndex, Length);
  }

  public bool SameAs(Slice other) {
    if (Length != other.Length) return false;

    for (int i = 0; i < Length; i++) {
      if (this[i] != other[i]) return false;
    }

    return true;
  }

  public bool SameAs(string other) {
    if (Length != other.Length) return false;

    for (int i = 0; i < Length; i++) {
      if (this[i] != other[i]) return false;
    }

    return true;
  }

  public int IndexOf(string lookingFor, int startOffset = 0) {
    int result = Base.IndexOf(lookingFor, StartIndex + startOffset, StringComparison.Ordinal);
    return result == -1 || result >= EndIndex ? -1 : result - StartIndex;
  }

  public int IndexOf(char lookingFor, int startOffset = 0) {
    int result = Base.IndexOf(lookingFor, StartIndex + startOffset);
    return result == -1 || result >= EndIndex ? -1 : result - StartIndex;
  }

  public Slice UnixLine(int count) {
    if (count <= 0) throw new ArgumentException("Count must be greater than 0", nameof(count));

    int lineStart = 0;
    for (int i = 1; i < count; i++) {
      lineStart = IndexOf('\n', lineStart);
      if (lineStart < 0) throw new ArgumentException($"The string has only {i - 1} lines, not {count}");
      lineStart++;
    }

    int lineEnd = IndexOf('\n', lineStart);
    return lineEnd == -1 ? new Slice(Base, StartIndex + lineStart, EndIndex) : new Slice(Base, StartIndex + lineStart, StartIndex + lineEnd);
  }

  public override bool Equals(object obj) {
    if (ReferenceEquals(this, obj)) return true;
    if (obj is Slice other) return SameAs(other);
    return false;
  }

  public override int GetHashCode() {
    int h = 0;
    for (int i = StartIndex; i < EndIndex; i++) {
      h = 31 * h + Base[i];
    }
    return h;
  }

  public string ReplaceSelfWith(string s) {
    int deltaLength = s.Length - Length;
    var builder = new System.Text.StringBuilder(Base.Length + deltaLength);
    builder.Append(Base, 0, StartIndex);
    builder.Append(s);
    builder.Append(Base, EndIndex, Base.Length - EndIndex);
    return builder.ToString();
  }

  public int BaseLineAtOffset(int index) {
    return 1 + new Slice(Base, 0, index).Count(c => c == '\n');
  }

  private int Count(Func<char, bool> predicate) {
    int count = 0;
    for (int i = StartIndex; i < EndIndex; i++) {
      if (predicate(Base[i])) count++;
    }
    return count;
  }
}
