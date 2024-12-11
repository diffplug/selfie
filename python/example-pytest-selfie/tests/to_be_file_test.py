import os
from pathlib import Path

from pytest_selfie import FSImplementation
from selfie_lib.WriteTracker import (
    SnapshotFileLayout,
    ToBeFileWriteTracker,
    TypedPath,
    recordCall,
)


class TestSnapshotFileLayout(SnapshotFileLayout):
    def get_snapshot_file(self, test_file: TypedPath) -> TypedPath:
        """Return the path to the snapshot file for the current test."""
        test_dir = os.path.dirname(str(test_file))
        test_name = os.path.splitext(os.path.basename(str(test_file)))[0]
        return TypedPath(os.path.join(test_dir, f"{test_name}.ss"))


def test_to_be_file():
    layout = TestSnapshotFileLayout(FSImplementation())
    tracker = ToBeFileWriteTracker()

    # Record the current call stack.
    call_stack = recordCall(callerFileOnly=True)

    # Create a TypedPath object for the file path
    file_path = TypedPath(os.path.abspath(Path("test.jpg")))

    # Write byte data to disk using the tracker.
    tracker.writeToDisk(file_path, b"some byte data", call_stack, layout)
