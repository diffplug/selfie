from threading import Lock
from typing import List, Optional, Dict

from .Snapshot import Snapshot
from .SnapshotReader import SnapshotReader
from .SnapshotValueReader import SnapshotValueReader
from .ArrayMap import ArrayMap


class SnapshotFile:
    HEADER_PREFIX: str = "📷 "
    END_OF_FILE: str = "[end of file]"

    def __init__(self):
        self.unix_newlines: bool = True
        self.metadata: Optional[Dict[str, str]] = None
        self._snapshots: ArrayMap[str, Snapshot] = ArrayMap.empty()
        self._lock: Lock = Lock()
        self.was_set_at_test_time: bool = False

    def serialize(self, value_writer: List[str]) -> None:
        if self.metadata:
            for key, value in self.metadata.items():
                value_writer.append(f"╔═ 📷 {key} ═╗\n{value}\n")

        for key, snapshot in self._snapshots.items():
            subject_str = (
                snapshot._subject.value_string()
                if hasattr(snapshot._subject, "value_string")
                else str(snapshot._subject)
            )
            value_writer.append(f"╔═ {key} ═╗\n{subject_str}\n")
            for facet_key, facet_value in snapshot.facets.items():
                facet_value_str = (
                    facet_value.value_string()
                    if hasattr(facet_value, "value_string")
                    else str(facet_value)
                )
                value_writer.append(f"╔═ {key}[{facet_key}] ═╗\n{facet_value_str}\n")
        value_writer.append("╔═ [end of file] ═╗\n")

    def set_at_test_time(self, key: str, snapshot: Snapshot) -> None:
        with self._lock:
            self._snapshots = self._snapshots.plus(key, snapshot)
            self.was_set_at_test_time = True

    def remove_all_indices(self, indices: List[int]) -> None:
        with self._lock:
            if not indices:
                return
            self._snapshots = self._snapshots.minus_sorted_indices(indices)
            self.was_set_at_test_time = True

    @classmethod
    def parse(cls, value_reader: SnapshotValueReader) -> "SnapshotFile":
        result = cls()
        result.unix_newlines = value_reader.unix_newlines
        reader = SnapshotReader(value_reader)

        peek_key = reader.peek_key()
        if peek_key and peek_key.startswith(cls.HEADER_PREFIX):
            metadata_name = peek_key[len(cls.HEADER_PREFIX) :]
            metadata_value = value_reader.next_value().value_string()
            result.metadata = {metadata_name: metadata_value}
            reader.next_snapshot()

        while True:
            peek_key = reader.peek_key()
            if peek_key is None or peek_key == cls.END_OF_FILE:
                break
            if peek_key.startswith(cls.HEADER_PREFIX):
                continue
            next_snapshot = reader.next_snapshot()
            result._snapshots = result._snapshots.plus(peek_key, next_snapshot)

        return result

    @classmethod
    def create_empty_with_unix_newlines(cls, unix_newlines: bool) -> "SnapshotFile":
        result = cls()
        result.unix_newlines = unix_newlines
        return result
