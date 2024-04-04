from threading import Lock
from collections import OrderedDict
from base64 import b64encode
from typing import Type, Optional, Dict, List, TypeVar, ClassVar
from .Snapshot import Snapshot
from .SnapshotReader import SnapshotReader
from .ParseException import ParseException
from .IllegalArgumentException import IllegalArgumentException
from .SnapshotValue import SnapshotValue
from .SnapshotValueReader import SnapshotValueReader

TSnapshotFile = TypeVar("TSnapshotFile", bound="SnapshotFile")


class SnapshotFile:
    HEADER_PREFIX: ClassVar[str] = "📷 "
    END_OF_FILE: ClassVar[str] = "[end of file]"

    def __init__(self):
        self.unix_newlines: bool = True
        self.metadata: Optional[Dict[str, str]] = None
        self._snapshots: OrderedDict[str, Snapshot] = OrderedDict()
        self._lock: Lock = Lock()
        self.was_set_at_test_time: bool = False

    def serialize(self, value_writer: List[str]) -> None:
        # Serialize metadata
        if self.metadata:
            for key, value in self.metadata.items():
                value_writer.append(f"╔═ 📷 {key} ═╗\n{value}\n")

        # Serialize snapshots and their facets
        for key, snapshot in self._snapshots.items():
            # Assuming snapshot._subject is a SnapshotValue object, call its value_string method
            subject_str = (
                snapshot._subject.value_string()
                if hasattr(snapshot._subject, "value_string")
                else str(snapshot._subject)
            )
            value_writer.append(f"╔═ {key} ═╗\n{subject_str}\n")

            for facet_key, facet_value in snapshot.facets.items():
                # Similarly, convert facet_value to string
                facet_value_str = (
                    facet_value.value_string()
                    if hasattr(facet_value, "value_string")
                    else str(facet_value)
                )
                value_writer.append(f"╔═ {key}[{facet_key}] ═╗\n{facet_value_str}\n")

        # End of file
        value_writer.append("╔═ [end of file] ═╗\n")

    @staticmethod
    def write_entry(
        value_writer: List[str],
        key: str,
        facet: Optional[str],
        value: SnapshotValue,
        newline_char: str,
    ) -> None:
        entry_line = f"╔═ {key}"
        if facet:
            entry_line += f"[{facet}]"
        entry_line += " ═╗" + newline_char

        if hasattr(value, "is_binary") and value.is_binary:
            encoded = b64encode(value.value_binary()).decode()
            entry_line += f"base64 length {len(value.value_binary())} bytes{newline_char}{encoded}{newline_char}"
        elif hasattr(value, "value_string"):
            entry_line += f"{value.value_string()}{newline_char}"
        else:
            entry_line += f"{str(value)}{newline_char}"

        value_writer.append(entry_line)

    def set_at_test_time(self, key: str, snapshot: Snapshot) -> None:
        with self._lock:
            old_snapshots = self._snapshots.copy()
            self._snapshots[key] = snapshot
            if old_snapshots != self._snapshots:
                self.was_set_at_test_time = True

    def remove_all_indices(self, indices: List[int]) -> None:
        with self._lock:
            if not indices:
                return

        indices = sorted(indices, reverse=True)
        items = list(self._snapshots.items())

        for index in indices:
            if 0 <= index < len(items):
                del items[index]

        self._snapshots = OrderedDict(items)
        self.was_set_at_test_time = True

    @classmethod
    def parse(
        cls: Type[TSnapshotFile], value_reader: SnapshotValueReader
    ) -> "SnapshotFile":
        try:
            result = cls()
            result.unix_newlines = value_reader.unix_newlines

            reader: SnapshotReader = SnapshotReader(value_reader)

            peek_key: Optional[str] = reader.peek_key()
            if peek_key and peek_key.startswith(cls.HEADER_PREFIX):
                metadata_name: str = peek_key[len(cls.HEADER_PREFIX) :]
                metadata_value: str = value_reader.next_value().value_string()
                result.metadata = {metadata_name: metadata_value}

            while True:
                peek_key = reader.peek_key()
                if peek_key is None or peek_key == cls.END_OF_FILE:
                    break
                next_snapshot = reader.next_snapshot()
                result._snapshots[peek_key] = next_snapshot

            return result
        except IllegalArgumentException as e:
            raise ParseException(value_reader.line_reader, str(e))

    @classmethod
    def create_empty_with_unix_newlines(
        cls: Type[TSnapshotFile], unix_newlines: bool
    ) -> "SnapshotFile":
        result = cls()
        result.unix_newlines = unix_newlines
        return result
