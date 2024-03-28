from .SnapshotValue import SnapshotValue
from collections import OrderedDict

class Snapshot:
    def __init__(self, subject, facet_data):
        self._subject = subject
        self._facet_data = facet_data

    @property
    def facets(self):
        return OrderedDict(sorted(self._facet_data.items()))

    def plus_facet(self, key, value):
        if isinstance(value, bytes):
            value = SnapshotValue.of(value)
        elif isinstance(value, str):
            value = SnapshotValue.of(value)
        return self._plus_facet(key, value)

    def _plus_facet(self, key, value):
        if not key:
            raise ValueError("The empty string is reserved for the subject.")
        facet_data = dict(self._facet_data)
        facet_data[self._unix_newlines(key)] = value
        return Snapshot(self._subject, facet_data)

    def plus_or_replace(self, key, value):
        if not key:
            return Snapshot(value, self._facet_data)
        facet_data = dict(self._facet_data)
        facet_data[self._unix_newlines(key)] = value
        return Snapshot(self._subject, facet_data)

    def subject_or_facet_maybe(self, key):
        if not key:
            return self._subject
        return self._facet_data.get(key)

    def subject_or_facet(self, key):
        value = self.subject_or_facet_maybe(key)
        if value is None:
            raise KeyError(f"'{key}' not found in {list(self._facet_data.keys())}")
        return value

    def all_entries(self):
        entries = [("", self._subject)]
        entries.extend(self._facet_data.items())
        return entries

    def __str__(self):
        return f"[{self._subject} {self._facet_data}]"

    @staticmethod
    def of(binary):
        return Snapshot(SnapshotValue.of(binary), {})

    @staticmethod
    def of(string):
        return Snapshot(SnapshotValue.of(string), {})

    @staticmethod
    def of_entries(entries):
        subject = None
        facet_data = {}
        for key, value in entries:
            if not key:
                if subject is not None:
                    raise ValueError(f"Duplicate root snapshot.\n first: {subject}\nsecond: {value}")
                subject = value
            else:
                facet_data[key] = value
        if subject is None:
            subject = SnapshotValue.of("")
        return Snapshot(subject, facet_data)

    @staticmethod
    def _unix_newlines(string):
        return string.replace("\\r\\n", "\\n")