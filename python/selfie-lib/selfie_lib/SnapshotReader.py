from .Snapshot import Snapshot


class SnapshotReader:
    def __init__(self, value_reader):
        self.value_reader = value_reader

    def peek_key(self) -> Optional[str]:
        next_key = self.value_reader.peek_key()
        if next_key is None or next_key == "[end of file]":
            return None
        return next_key

    def next_snapshot(self):
        root_name = self.peek_key()
        snapshot = Snapshot.of(self.value_reader.next_value())
        while True:
            next_key: Optional[str] = self.value_reader.peek_key()
            if next_key is None or next_key == "[end of file]":
                break
            facet_idx: int = next_key.find("[")
            if facet_idx == -1:
                break
            else:
                facet_root, facet_name = (
                    next_key[:facet_idx],
                    next_key[facet_idx + 1 : -1],
                )
                if facet_root == root_name:
                    facet_value = self.value_reader.next_value()
                    snapshot = snapshot.plus_facet(facet_name, facet_value)
                else:
                    break
        return snapshot

    def skip_snapshot(self):
        root_name = self.peek_key()
        if root_name is None:
            raise ValueError("No snapshot to skip")
        self.value_reader.skip_value()
        while True:
            next_key = self.peek_key()
            if next_key is None or not next_key.startswith(f"{root_name}["):
                break
            self.value_reader.skip_value()
