from typing import Dict, Optional, Union
from collections import OrderedDict
from .SnapshotValue import SnapshotValue
from .SnapshotValue import SnapshotValueBinary
from .SnapshotValue import SnapshotValueString


class Snapshot:
    _subject: SnapshotValue
    _facet_data: Dict[str, SnapshotValue]

    def __init__(
        self, subject: SnapshotValue, facet_data: Dict[str, SnapshotValue]
    ) -> None:
        self._subject = subject
        self._facet_data = facet_data

    @property
    def facets(self) -> OrderedDict:
        return OrderedDict(sorted(self._facet_data.items()))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Snapshot):
            return NotImplemented
        return self._subject == other._subject and self._facet_data == other._facet_data

    def __hash__(self) -> int:
        return hash((self._subject, frozenset(self._facet_data.items())))

    def plus_facet(
        self, key: str, value: Union[bytes, str, SnapshotValue]
    ) -> "Snapshot":
        """
        Add a facet with the given key and value to the snapshot.
        The value can be bytes, a string, or a SnapshotValue.
        """
        # Ensure value is converted to SnapshotValue if it's not already one
        if isinstance(value, bytes):
            value = SnapshotValueBinary(value)
        elif isinstance(value, str):
            value = SnapshotValueString(value)
        elif not isinstance(value, SnapshotValue):
            raise TypeError("Value must be either bytes, str, or SnapshotValue")

        # Now we can safely pass a SnapshotValue instance to _plus_facet
        return self._plus_facet(key, value)

    def _plus_facet(self, key: str, value: SnapshotValue) -> "Snapshot":
        """
        The actual implementation to add a facet. This method should only be called
        with a SnapshotValue instance as value.
        """
        if not key:
            raise ValueError("The empty string is reserved for the subject.")
        facet_data = dict(self._facet_data)
        facet_data[key] = value  # Here, value is guaranteed to be a SnapshotValue
        return Snapshot(self._subject, facet_data)

    def plus_or_replace(self, key: str, value: SnapshotValue) -> "Snapshot":
        if not key:
            return Snapshot(value, self._facet_data)
        facet_data: Dict[str, SnapshotValue] = dict(self._facet_data)
        facet_data[self._unix_newlines(key)] = value
        return Snapshot(self._subject, facet_data)

    def subject_or_facet_maybe(self, key: str) -> Optional[SnapshotValue]:
        if not key:
            return self._subject
        return self._facet_data.get(key)

    def subject_or_facet(self, key: str) -> SnapshotValue:
        value = self.subject_or_facet_maybe(key)
        if value is None:
            raise KeyError(f"'{key}' not found in {list(self._facet_data.keys())}")
        return value

    def all_entries(self) -> Dict[str, SnapshotValue]:
        entries: Dict[str, SnapshotValue] = {"": self._subject}
        entries.update(self._facet_data)
        return entries

    @staticmethod
    def of(data: Union[bytes, str, SnapshotValue]) -> "Snapshot":
        if isinstance(data, (bytes, str)):
            data = SnapshotValue.of(data)
        if not isinstance(data, SnapshotValue):
            raise TypeError("Data must be either binary, string, or SnapshotValue")
        return Snapshot(data, {})

    @staticmethod
    def of_entries(entries: Dict[str, SnapshotValue]) -> "Snapshot":
        subject: Optional[SnapshotValue] = None
        facet_data: Dict[str, SnapshotValue] = {}
        for key, value in entries.items():
            if not key:
                if subject is not None:
                    raise ValueError("Duplicate root snapshot detected")
                subject = value
            else:
                facet_data[key] = value
        return Snapshot(
            subject if subject is not None else SnapshotValue.of(""), facet_data
        )

    @staticmethod
    def _unix_newlines(string: str) -> str:
        return string.replace("\\r\\n", "\\n")
