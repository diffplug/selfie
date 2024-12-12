import base64
from threading import Lock
from typing import Optional

from .ArrayMap import ArrayMap
from .Snapshot import Snapshot, SnapshotValue
from .SnapshotReader import SnapshotReader
from .SnapshotValueReader import SnapshotValueReader


class SnapshotFile:
    HEADER_PREFIX: str = "📷 "
    END_OF_FILE: str = "[end of file]"

    def __init__(self):
        self.unix_newlines: bool = True
        self.metadata: Optional[tuple[str, str]] = None
        self.snapshots: ArrayMap[str, Snapshot] = ArrayMap.empty()
        self._lock: Lock = Lock()
        self.was_set_at_test_time: bool = False

    def serialize(self, valueWriter: list[str]):
        if self.metadata is not None:
            self.writeEntry(
                valueWriter,
                f"📷 {self.metadata[0]}",
                None,
                SnapshotValue.of(self.metadata[1]),
            )

        for entry_key, entry_value in self.snapshots.items():
            self.writeEntry(valueWriter, entry_key, None, entry_value.subject)
            for facet_key, facet_value in entry_value.facets.items():
                self.writeEntry(valueWriter, entry_key, facet_key, facet_value)

        self.writeEntry(valueWriter, "", "end of file", SnapshotValue.of(""))

    @staticmethod
    def writeEntry(
        valueWriter: list[str], key: str, facet: Optional[str], value: SnapshotValue
    ):
        valueWriter.append("╔═ ")
        valueWriter.append(SnapshotValueReader.name_esc.escape(key))
        if facet is not None:
            valueWriter.append("[")
            valueWriter.append(SnapshotValueReader.name_esc.escape(facet))
            valueWriter.append("]")
        valueWriter.append(" ═╗")
        if value.is_binary:
            valueWriter.append(" base64 length ")
            valueWriter.append(str(len(value.value_binary())))
            valueWriter.append(" bytes")
        valueWriter.append("\n")

        if not key and facet == "end of file":
            return

        if value.is_binary:
            escaped = base64.b64encode(value.value_binary()).decode("utf-8")
            valueWriter.append(escaped.replace("\r", ""))
        else:
            escaped = SnapshotValueReader.body_esc.escape(value.value_string()).replace(
                "\n╔", "\n\ud801\udf41"
            )
            valueWriter.append(escaped)
        valueWriter.append("\n")

    def set_at_test_time(self, key: str, snapshot: Snapshot) -> None:
        with self._lock:
            self.snapshots = self.snapshots.plus_or_noop_or_replace(key, snapshot)
            self.was_set_at_test_time = True

    def remove_all_indices(self, indices: list[int]) -> None:
        with self._lock:
            if not indices:
                return
            self.snapshots = self.snapshots.minus_sorted_indices(indices)
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
            result.metadata = (metadata_name, metadata_value)
            reader.next_snapshot()

        while True:
            peek_key = reader.peek_key()
            if peek_key is None or peek_key == cls.END_OF_FILE:
                break
            if peek_key.startswith(cls.HEADER_PREFIX):
                continue
            next_snapshot = reader.next_snapshot()
            result.snapshots = result.snapshots.plus(peek_key, next_snapshot)

        return result

    @classmethod
    def create_empty_with_unix_newlines(cls, unix_newlines: bool) -> "SnapshotFile":
        result = cls()
        result.unix_newlines = unix_newlines
        return result
