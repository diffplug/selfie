from typing import Optional
from .Snapshot import Snapshot
from .SnapshotValueReader import SnapshotValueReader


class SnapshotReader:
    def __init__(self, value_reader: SnapshotValueReader) -> None:
        self.value_reader: SnapshotValueReader = value_reader

    def peek_key(self) -> Optional[str]:
        next_key: Optional[str] = self.value_reader.peek_key()
        if next_key is None or next_key == "[end of file]":
            return None
        if "[" in next_key:
            raise ValueError(
                f"Missing root snapshot, square brackets not allowed: '{next_key}'"
            )
        return next_key

    def next_snapshot(self) -> Snapshot:
        root_name: Optional[str] = self.peek_key()
        snapshot: Snapshot = Snapshot.of(self.value_reader.next_value())
        while True:
            next_key: Optional[str] = self.value_reader.peek_key()
            if next_key is None:
                return snapshot
            facet_idx: int = next_key.find("[")
            if facet_idx == -1 or (facet_idx == 0 and next_key == "[end of file]"):
                return snapshot
            facet_root: str = next_key[:facet_idx]
            if facet_root != root_name:
                raise ValueError(
                    f"Expected '{next_key}' to come after '{facet_root}', not '{root_name}'"
                )
            facet_end_idx: int = next_key.find("]", facet_idx + 1)
            if facet_end_idx == -1:
                raise ValueError(f"Missing ] in {next_key}")
            facet_name: str = next_key[facet_idx + 1 : facet_end_idx]
            snapshot = snapshot.plus_facet(facet_name, self.value_reader.next_value())

    def skip_snapshot(self) -> None:
        root_name: Optional[str] = self.peek_key()
        if root_name is None:
            raise ValueError("No snapshot to skip")
        self.value_reader.skip_value()
        while True:
            next_key: Optional[str] = self.peek_key()
            if next_key is None or not next_key.startswith(f"{root_name}["):
                break
            self.value_reader.skip_value()
