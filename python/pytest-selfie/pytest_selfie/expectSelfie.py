import os
import pytest
from selfie_lib.Snapshot import Snapshot


def expectSelfie(actual: str):
    # Get the expected snapshot
    expected_snapshot = Snapshot.of(actual)

    # Get the string representation of expected snapshot
    expected_str = expected_snapshot.subject_or_facet("").value_string()

    # Compare the actual result with the expected snapshot
    if actual != expected_str:
        pytest.fail(f"Expected '{expected_str}', but got '{actual}'")
