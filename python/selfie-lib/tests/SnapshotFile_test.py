from selfie_lib import SnapshotFile, SnapshotValueReader, Snapshot


def test_read_with_metadata():
    file_content = """
╔═ 📷 com.acme.AcmeTest ═╗
{"header":"data"}
╔═ Apple ═╗
Granny Smith
╔═ Apple[color] ═╗
green
╔═ Apple[crisp] ═╗
yes
╔═ Orange ═╗
Orange
╔═ [end of file] ═╗
""".strip()
    file = SnapshotFile.parse(SnapshotValueReader.of(file_content))
    assert file.metadata == ("com.acme.AcmeTest", """{"header":"data"}""")


def test_read_without_metadata():
    file_content = """
╔═ Apple ═╗
Apple
╔═ Apple[color] ═╗
green
╔═ Apple[crisp] ═╗
yes
╔═ Orange ═╗
Orange
╔═ [end of file] ═╗
""".strip()
    file = SnapshotFile.parse(SnapshotValueReader.of(file_content))
    assert file.metadata is None
    assert set(file.snapshots.keys()) == {"Apple", "Orange"}


def test_write():
    underTest = SnapshotFile()
    underTest.metadata = ("com.acme.AcmeTest", """{"header":"data"}""")

    apple_snapshot = Snapshot.of("Granny Smith")
    apple_snapshot = apple_snapshot.plus_facet("color", "green")
    apple_snapshot = apple_snapshot.plus_facet("crisp", "yes")

    underTest.snapshots = underTest.snapshots.plus("Apple", apple_snapshot)
    underTest.snapshots = underTest.snapshots.plus("Orange", Snapshot.of("Orange"))

    buffer = []
    underTest.serialize(buffer)

    expected_output = """╔═ 📷 com.acme.AcmeTest ═╗
{"header":"data"}
╔═ Apple ═╗
Granny Smith
╔═ Apple[color] ═╗
green
╔═ Apple[crisp] ═╗
yes
╔═ Orange ═╗
Orange
╔═ [end of file] ═╗
"""

    assert "".join(buffer) == expected_output
