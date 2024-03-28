import threading
from typing import List
import base64

from .SnapshotValue import SnapshotValue
from .ConvertToWindowsNewlines import ConvertToWindowsNewlines
from .ParseException import ParseException
from .SnapshotReader import SnapshotReader
from .SnapshotValueReader import SnapshotValueReader

class SnapshotFile:
    HEADER_PREFIX = "📷 "
    END_OF_FILE = "[end of file]"

    def __init__(self):
        self.unix_newlines = True
        self.metadata = None
        self._snapshots = {}
        self._lock = threading.Lock()
        self._was_set_at_test_time = False

    @property
    def snapshots(self):
        return self._snapshots

    @snapshots.setter
    def snapshots(self, value):
        with self._lock:
            self._snapshots = value

    @property
    def was_set_at_test_time(self):
        return self._was_set_at_test_time

    def set_at_test_time(self, key, snapshot):
        with self._lock:
            old_snapshots = self._snapshots.copy()
            self._snapshots[key] = snapshot
            self._was_set_at_test_time = True if self._snapshots != old_snapshots else self._was_set_at_test_time

    def serialize(self, value_writer_raw):
        value_writer = value_writer_raw if self.unix_newlines else ConvertToWindowsNewlines(value_writer_raw)
        if self.metadata:
            self.write_entry(value_writer, f"📷 {self.metadata[0]}", None, SnapshotValue.of(self.metadata[1]))
        for key, snapshot in self._snapshots.items():
            self.write_entry(value_writer, key, None, snapshot.subject)
            for facet_key, facet_value in snapshot.facets.items():
                self.write_entry(value_writer, key, facet_key, facet_value)
        self.write_entry(value_writer, "", "end of file", SnapshotValue.of(""))

    def write_entry(value_writer, key, facet, value):
        value_writer.write("╔═ ")
        value_writer.write(SnapshotValueReader.nameEsc.escape(key))
        if facet is not None:
            value_writer.write("[")
            value_writer.write(SnapshotValueReader.nameEsc.escape(facet))
            value_writer.write("]")
        value_writer.write(" ═╗")
        if value.is_binary:
            binary_length = len(value.value_binary())
            value_writer.write(f" base64 length {binary_length} bytes")
        value_writer.write("\n")

        if key == "" and facet == "end of file":
            return

        if value.is_binary:
            # Base64 encoding and replacing \r with an empty string
            binary_data = value.value_binary()
            encoded = base64.b64encode(binary_data).decode('utf-8')
            # Assuming efficientReplace is a more efficient method for replacing characters
            # Here, we just use the regular replace method for simplicity
            escaped = encoded.replace("\r", "")
            value_writer.write(escaped)
        else:
            # For string values, applying specific escape logic and then replacing "\n╔" with a special sequence
            text_data = value.value_string()
            escaped = SnapshotValueReader.bodyEsc(text_data).replace("\n╔", "\n\uDF41")
            value_writer.write(escaped)
        value_writer.write("\n")

    @staticmethod
    def parse(value_reader):
        try:
            result = SnapshotFile()
            result.unix_newlines = value_reader.unix_newlines
            reader = SnapshotReader(value_reader)

            # Check if the first value starts with 📷
            if reader.peek_key() and reader.peek_key().startswith(SnapshotFile.HEADER_PREFIX):
                metadata_name = reader.peek_key()[len(SnapshotFile.HEADER_PREFIX):]
                metadata_value = reader.value_reader.next_value().value_string()
                # Assuming 'entry' function creates a dictionary entry in Python
                result.metadata = (metadata_name, metadata_value)

            while reader.peek_key() is not None:
                key = reader.peek_key()
                snapshot = reader.next_snapshot()
                # Update snapshots dictionary with new key-value pair
                result.snapshots.update({key: snapshot})

            return result

        except ValueError as e:
            if isinstance(e, ParseException):
                raise e
            else:
                raise ParseException(value_reader.line_reader, e) from None


    @staticmethod
    def create_empty_with_unix_newlines(unix_newlines):
        result = SnapshotFile()
        result.unix_newlines = unix_newlines
        return result

    def remove_all_indices(self, indices: List[int]):
        if not indices:
            return
        self._was_set_at_test_time = True
        self.snapshots = self.snapshots.minus_sorted_indices(indices)
