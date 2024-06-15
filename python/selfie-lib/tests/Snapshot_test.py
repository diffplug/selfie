from selfie_lib import Snapshot


def test_items():
    undertest = (
        Snapshot.of("subject").plus_facet("key1", "value1").plus_facet("key2", "value2")
    )
    roundtrip = Snapshot.of_items(undertest.items())
    assert roundtrip == undertest
