from typing import Optional
class Slice:
    """Represents a slice of a base string from startIndex to endIndex."""

    def __init__(self, base, startIndex=0, endIndex=None):  # type: (str, int, Optional[int]) -> None
        self.base = base
        self.startIndex = startIndex
        self.endIndex = endIndex if endIndex is not None else len(base)

        assert 0 <= self.startIndex <= self.endIndex <= len(base), "Invalid start or end index"

    def __len__(self):  # type: () -> int
        return self.endIndex - self.startIndex

    def __getitem__(self, index):  # type: (int) -> str
        if not (0 <= index < len(self)):
            raise IndexError("Index out of range")
        return self.base[self.startIndex + index]

    def subSequence(self, start, end):  # type: (int, int) -> 'Slice'
        return Slice(self.base, self.startIndex + start, self.startIndex + end)

    def trim(self):  # type: () -> 'Slice'
        start, end = 0, len(self)
        while start < end and self[start].isspace():
            start += 1
        while start < end and self[end - 1].isspace():
            end -= 1
        return self.subSequence(start, end) if start > 0 or end < len(self) else self

    def __str__(self):  # type: () -> str
        return self.base[self.startIndex:self.endIndex]

    def sameAs(self, other):  # type: (str) -> bool
        if len(self) != len(other):
            return False
        for i in range(len(self)):
            if self[i] != other[i]:
                return False
        return True

    def indexOf(self, lookingFor, startOffset=0):  # type: (str, int) -> int
        result = self.base.find(lookingFor, self.startIndex + startOffset, self.endIndex)
        return -1 if result == -1 else result - self.startIndex

    def unixLine(self, count):  # type: (int) -> 'Slice'
        assert count > 0, "Count must be positive"
        lineStart = 0
        for i in range(1, count):
            lineStart = self.indexOf('\n', lineStart)
            assert lineStart >= 0, f"This string has only {i - 1} lines, not {count}"
            lineStart += 1
        lineEnd = self.indexOf('\n', lineStart)
        return Slice(self.base, self.startIndex + lineStart, self.endIndex if lineEnd == -1 else self.startIndex + lineEnd)

    def __eq__(self, other):  # type: (object) -> bool
        if self is other:
            return True
        if isinstance(other, Slice):
            return self.sameAs(other)
        return False

    def __hash__(self):  # type: () -> int
        h = 0
        for i in range(len(self)):
            h = 31 * h + ord(self[i])
        return h

    def replaceSelfWith(self, s):  # type: (str) -> str
        return self.base[:self.startIndex] + s + self.base[self.endIndex:]

    def baseLineAtOffset(self, index):  # type: (int) -> int
        return 1 + Slice(self.base, 0, index).count('\n')
