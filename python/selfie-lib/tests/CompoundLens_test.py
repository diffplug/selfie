from selfie_lib import CompoundLens, Snapshot


def test_replace_all():
    replace_all = CompoundLens().replace_all("e", "E")
    assert (
        repr(replace_all(Snapshot.of("subject").plus_facet("key", "value")))
        == """Snapshot.of('subjEct')
  .plus_facet('key', 'valuE')"""
    )


def test_replace_all_regex():
    replace_all_regex = CompoundLens().replace_all_regex(r"(\w+)", r"\1!")
    assert (
        repr(
            replace_all_regex(
                Snapshot.of("this is subject").plus_facet("key", "this is facet")
            )
        )
        == """Snapshot.of('this! is! subject!')
  .plus_facet('key', 'this! is! facet!')"""
    )


def test_set_facet_from():
    set_facet_from = CompoundLens().set_facet_from("uppercase", "", lambda s: s.upper())
    assert (
        repr(set_facet_from(Snapshot.of("subject")))
        == """Snapshot.of('subject')
  .plus_facet('uppercase', 'SUBJECT')"""
    )


def test_mutate_facet():
    mutate_facet = CompoundLens().mutate_facet("key", lambda s: s.upper())
    assert (
        repr(mutate_facet(Snapshot.of("subject").plus_facet("key", "facet")))
        == """Snapshot.of('subject')
  .plus_facet('key', 'FACET')"""
    )
