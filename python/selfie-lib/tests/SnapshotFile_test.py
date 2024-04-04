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
    assert file.metadata == {"com.acme.AcmeTest": """{"header":"data"}"""}


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
    assert set(file._snapshots.keys()) == {"Apple", "Orange"}


def test_write():
    underTest = SnapshotFile()
    # Assuming metadata should be a dictionary
    underTest.metadata = {"com.acme.AcmeTest": """{"header":"data"}"""}

    # Create and add snapshots
    apple_snapshot = Snapshot.of("Granny Smith")
    apple_snapshot = apple_snapshot.plus_facet("color", "green")
    apple_snapshot = apple_snapshot.plus_facet("crisp", "yes")

    # Directly assigning snapshots to the '_snapshots' dictionary
    underTest._snapshots["Apple"] = apple_snapshot
    underTest._snapshots["Orange"] = Snapshot.of("Orange")

    # Simulating a buffer to capture the serialized output
    buffer = []
    underTest.serialize(buffer)

    # Define expected output
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
