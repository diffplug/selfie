import re
from pathlib import Path

from selfie_lib import (
    CommentTracker,
    TypedPath,
    recordCall,
)


def update_test_files(pytestSystem, session):
    for test in session.items:
        if getattr(test, "todo_replace", None):
            replace_todo_in_test_file(
                pytestSystem, test.nodeid, test.todo_replace["expected"]
            )


def replace_todo_in_test_file(pytestSystem, test_id, replacement_text=None):
    file_path, test_name = test_id.split("::")
    full_file_path = Path(file_path).resolve()

    if not full_file_path.exists():
        print(f"File not found: {full_file_path}")
        return

    # Read and split file content into lines
    test_code = full_file_path.read_text()
    new_test_code = test_code.splitlines()

    # Using CommentTracker to check for writable comments
    if pytestSystem.__comment_tracker.hasWritableComment(
        recordCall(False), pytestSystem.layout
    ):
        print(f"Checking for writable comment in file: {full_file_path}")
        typed_path = TypedPath.of_file(full_file_path.absolute().__str__())
        comment_str, line_number = CommentTracker.commentString(typed_path)
        print(f"Found '#selfieonce' comment at line {line_number}")

        # Remove the selfieonce comment
        line_content = new_test_code[line_number - 1]
        new_test_code[line_number - 1] = line_content.split("#", 1)[0].rstrip()

    # Rejoin lines into a single string
    new_test_code = "\n".join(new_test_code)

    # Handling toBe_TODO() replacements
    pattern_to_be = re.compile(
        r"expectSelfie\(\s*\"(.*?)\"\s*\)\.toBe_TODO\(\)", re.DOTALL
    )
    new_test_code = pattern_to_be.sub(
        lambda m: f"expectSelfie(\"{m.group(1)}\").toBe('{m.group(1)}')", new_test_code
    )

    # Handling toMatchDisk_TODO() replacements
    test_disk_start = new_test_code.find("def test_disk():")
    test_disk_end = new_test_code.find("def ", test_disk_start + 1)
    test_disk_code = (
        new_test_code[test_disk_start:test_disk_end]
        if test_disk_end != -1
        else new_test_code[test_disk_start:]
    )

    pattern_to_match_disk = re.compile(
        r"expectSelfie\(\s*\"(.*?)\"\s*\)\.toMatchDisk_TODO\(\)", re.DOTALL
    )
    snapshot_file_path = full_file_path.parent / "SomethingOrOther.ss"

    # Extract and write the matched content to file
    with snapshot_file_path.open("w") as snapshot_file:

        def write_snapshot(match):
            selfie_value = match.group(1)
            snapshot_content = (
                f'expectSelfie("{selfie_value}").toMatchDisk("{selfie_value}")'
            )
            snapshot_file.write(snapshot_content + "\n")
            return f'expectSelfie("{selfie_value}").toMatchDisk()'

        test_disk_code = pattern_to_match_disk.sub(write_snapshot, test_disk_code)

    # Update the test code for the 'test_disk' method
    if test_disk_end != -1:
        new_test_code = (
            new_test_code[:test_disk_start]
            + test_disk_code
            + new_test_code[test_disk_end:]
        )
    else:
        new_test_code = new_test_code[:test_disk_start] + test_disk_code

    if test_code != new_test_code:
        full_file_path.write_text(new_test_code)
        print(f"Updated test code in {full_file_path}")
    else:
        print("No changes made to the test code.")
