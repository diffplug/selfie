from typing import Union
from .SnapshotValue import SnapshotValue, SnapshotValueBinary, SnapshotValueString
from .ArrayMap import ArrayMap


class Snapshot:
    def __init__(
        self,
        subject: SnapshotValue,
        facet_data: Union[ArrayMap[str, SnapshotValue], None] = None,
    ) -> None:
        self._subject = subject
        self._facet_data = facet_data if facet_data is not None else ArrayMap.empty()

    @property
    def facets(self) -> ArrayMap[str, SnapshotValue]:
        return self._facet_data

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Snapshot):
            return NotImplemented
        return self._subject == other._subject and self._facet_data == other._facet_data

    def __hash__(self) -> int:
        return hash((self._subject, tuple(self._facet_data.items())))

    def plus_facet(
        self, key: str, value: Union[bytes, str, SnapshotValue]
    ) -> "Snapshot":
        if isinstance(value, bytes):
            value = SnapshotValueBinary(value)
        elif isinstance(value, str):
            value = SnapshotValueString(value)
        elif not isinstance(value, SnapshotValue):
            raise TypeError("Value must be either bytes, str, or SnapshotValue")
        new_facet_data = self._facet_data.plus(key, value)
        return Snapshot(self._subject, new_facet_data)

    def plus_or_replace(self, key: str, value: SnapshotValue) -> "Snapshot":
        if not key:
            return Snapshot(value, self._facet_data)
        return Snapshot(self._subject, self._facet_data.plus(key, value))

    def subject_or_facet_maybe(self, key: str) -> Union[SnapshotValue, None]:
        try:
            return self._facet_data[key]
        except KeyError:
            return None if key else self._subject

    def subject_or_facet(self, key: str) -> SnapshotValue:
        value = self.subject_or_facet_maybe(key)
        if value is None:
            raise KeyError(f"'{key}' not found")
        return value

    @staticmethod
    def of(data: Union[bytes, str, SnapshotValue]) -> "Snapshot":
        if not isinstance(data, SnapshotValue):
            data = SnapshotValue.of(data)
        return Snapshot(data, ArrayMap.empty())

    @staticmethod
    def of_entries(entries: Union[ArrayMap[str, SnapshotValue], None]) -> "Snapshot":
        subject = entries.get("") if entries else None
        facet_data = entries if entries else ArrayMap.empty()
        return Snapshot(subject if subject else SnapshotValue.of(""), facet_data)

    @staticmethod
    def _unix_newlines(string: str) -> str:
        return string.replace("\\r\\n", "\\n")
