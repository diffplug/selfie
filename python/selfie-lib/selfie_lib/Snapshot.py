from .SnapshotValue import SnapshotValue

class Snapshot:
    def __init__(self, subject, facet_data=None):
        if facet_data is None:
            facet_data = {}
        self.subject = subject
        self._facet_data = facet_data

    @property
    def facets(self):
        return self._facet_data

    def plus_facet(self, key, value):
        if not key:
            raise ValueError("The empty string is reserved for the subject.")
        new_facet_data = self._facet_data.copy()
        new_facet_data[self._unix_newlines(key)] = SnapshotValue.of(value)
        return Snapshot(self.subject, new_facet_data)

    def plus_or_replace(self, key, value):
        if not key:
            return Snapshot(value, self._facet_data)
        new_facet_data = self._facet_data.copy()
        new_facet_data[self._unix_newlines(key)] = value
        return Snapshot(self.subject, new_facet_data)

    def subject_or_facet_maybe(self, key):
        if not key:
            return self.subject
        return self._facet_data.get(key)

    def subject_or_facet(self, key):
        result = self.subject_or_facet_maybe(key)
        if result is None:
            raise KeyError(f"'{key}' not found in {list(self._facet_data.keys())}")
        return result

    def all_entries(self):
        return {**{"": self.subject}, **self._facet_data}

    def __str__(self):
        return f"[{self.subject} {self._facet_data}]"

    @staticmethod
    def _unix_newlines(key):
        return key.replace("\r\n", "\n")

    @classmethod
    def of(cls, value):
        return cls(SnapshotValue.of(value))

    @classmethod
    def of_entries(cls, entries):
        root = None
        facets = {}
        for key, value in entries:
            if not key:
                if root is not None:
                    raise ValueError("Duplicate root snapshot.")
                root = value
            else:
                facets[key] = value
        return cls(root or SnapshotValue.of(""), facets)
