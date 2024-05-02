from selfie_lib.WriteTracker import (
    ToBeFileWriteTracker,
    ToBeFileLazyBytes,
    recordCall,
    TypedPath,
    SnapshotFileLayout,
)
from pytest_selfie import FSImplementation
from pathlib import Path
import os


def test_to_be_file():
    layout = SnapshotFileLayout(FSImplementation())
    tracker = ToBeFileWriteTracker()

    # Record the current call stack.
    call_stack = recordCall(callerFileOnly=True)

    # Create a TypedPath object for the file path
    file_path = TypedPath(os.path.abspath(Path("test.jpg")))

    # Write byte data to disk using the tracker.
    tracker.writeToDisk(file_path, b"some byte data", call_stack, layout)
