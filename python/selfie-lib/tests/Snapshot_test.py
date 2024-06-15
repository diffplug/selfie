from selfie_lib import Snapshot


def test_items():
    undertest = (
        Snapshot.of("subject").plus_facet("key1", "value1").plus_facet("key2", "value2")
    )
    roundtrip = Snapshot.of_items(undertest.items())
    assert roundtrip == undertest


def test_repr():
    assert repr(Snapshot.of("subject")) == "Snapshot.of('subject')"
    assert repr(Snapshot.of("subject\nline2")) == "Snapshot.of('subject\\nline2')"
    assert (
        repr(Snapshot.of("subject").plus_facet("apple", "green"))
        == "Snapshot.of('subject')\n  .plus_facet('apple', 'green')"
    )
    assert (
        repr(
            Snapshot.of("subject")
            .plus_facet("orange", "peel")
            .plus_facet("apple", "green")
        )
        == "Snapshot.of('subject')\n  .plus_facet('apple', 'green')\n  .plus_facet('orange', 'peel')"
    )
