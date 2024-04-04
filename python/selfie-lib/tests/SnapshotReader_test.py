from base64 import b64decode
from selfie_lib import SnapshotValueReader, Snapshot, SnapshotReader


class TestSnapshotReader:
    def test_facet(self):
        reader = SnapshotReader(
            SnapshotValueReader.of(
                """
╔═ Apple ═╗
Apple
╔═ Apple[color] ═╗
green
╔═ Apple[crisp] ═╗
yes
╔═ Orange ═╗
Orange
""".strip()
            )
        )
        assert reader.peek_key() == "Apple"
        assert reader.peek_key() == "Apple"
        apple_snapshot = (
            Snapshot.of("Apple").plus_facet("color", "green").plus_facet("crisp", "yes")
        )
        assert reader.next_snapshot() == apple_snapshot
        assert reader.peek_key() == "Orange"
        assert reader.peek_key() == "Orange"
        assert reader.next_snapshot() == Snapshot.of("Orange")
        assert reader.peek_key() is None

    def test_binary(self):
        reader = SnapshotReader(
            SnapshotValueReader.of(
                """
╔═ Apple ═╗
Apple
╔═ Apple[color] ═╗ base64 length 3 bytes
c2Fk
╔═ Apple[crisp] ═╗
yes
╔═ Orange ═╗ base64 length 3 bytes
c2Fk
""".strip()
            )
        )
        assert reader.peek_key() == "Apple"
        assert reader.peek_key() == "Apple"
        apple_snapshot = (
            Snapshot.of("Apple")
            .plus_facet("color", b64decode("c2Fk"))
            .plus_facet("crisp", "yes")
        )
        assert reader.next_snapshot() == apple_snapshot
        assert reader.peek_key() == "Orange"
        assert reader.peek_key() == "Orange"
        assert reader.next_snapshot() == Snapshot.of(b64decode("c2Fk"))
        assert reader.peek_key() is None
