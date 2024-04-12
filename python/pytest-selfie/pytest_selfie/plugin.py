from typing import Optional, Tuple
from selfie_lib import _initSelfieSystem, SnapshotSystem, TypedPath, recordCall
from selfie_lib import FS, SnapshotFile, SnapshotFileLayout, DiskStorage, CallStack, LiteralValue, Mode
from selfie_lib.CommentTracker import CommentTracker
from pathlib import Path
import pytest
import re


class FSImplementation(FS):
    def file_walk(self, typed_path, walk):
        pass

    def file_read_binary(self, typed_path) -> bytes:
        return b""

    def file_write_binary(self, typed_path, content: bytes):
        pass

    def assert_failed(self, message: str, expected=None, actual=None) -> Exception:
        raise Exception(message)


class DiskStorageImplementation(DiskStorage):
    def read_disk(self, sub: str, call: CallStack) -> Optional[SnapshotFile]:
        print(f"Reading from disk: sub={sub}")
        return None 

    def write_disk(self, actual: SnapshotFile, sub: str, call: CallStack):
        print(f"Writing to disk: {actual} at {sub}")

    def keep(self, sub_or_keep_all: Optional[str]):
        print(f"Keeping snapshot for: {sub_or_keep_all}")


class PytestSnapshotSystem(SnapshotSystem):
    def __init__(self):
        self._mode = Mode(can_write=True)
        self._comment_tracker = CommentTracker()

    @property
    def mode(self) -> Mode:
        return self._mode

    @property
    def fs(self) -> FS:
        return FSImplementation()  

    @property
    def layout(self) -> SnapshotFileLayout:
        return SnapshotFileLayout(self.fs)  

    def diskThreadLocal(self) -> DiskStorage:
        return DiskStorageImplementation()

    def source_file_has_writable_comment(self, call: CallStack) -> bool:
        layout = self.layout.sourcePathForCall(call)
        return self.comment_tracker.hasWritableComment(call, layout)

    def write_inline(self, literal_value: LiteralValue, call: CallStack):
        pass

    def finishedAllTests(self):
        pass


pytestSystem = PytestSnapshotSystem()


def pytest_addoption(parser):
    group = parser.getgroup("selfie")
    group.addoption(
        "--foo",
        action="store",
        dest="dest_foo",
        default="2024",
        help='Set the value for the fixture "bar".',
    )

    parser.addini("HELLO", "Dummy pytest.ini setting")


@pytest.fixture
def bar(request):
    return request.config.option.dest_foo


@pytest.hookimpl
def pytest_sessionstart(session: pytest.Session):
    print("SELFIE SESSION STARTED")
    replace_todo_in_test_file("tests/Simple_test.py::test_inline")
    global pytestSystem
    _initSelfieSystem(pytestSystem)


@pytest.hookimpl
def pytest_sessionfinish(session: pytest.Session, exitstatus):
    print("SELFIE SESSION FINISHED")
    update_test_files(session)
    pytestSystem.finishedAllTests()


def update_test_files(session):
    for test in session.items:
        if getattr(test, 'todo_replace', None):
            replace_todo_in_test_file(test.nodeid, test.todo_replace['expected'])


def replace_todo_in_test_file(test_id, replacement_text=None):
    file_path, test_name = test_id.split("::")
    full_file_path = Path(file_path).resolve()

    if not full_file_path.exists():
        print(f"File not found: {full_file_path}")
        return

    test_code = full_file_path.read_text()
    new_test_code = test_code

    # Creating CallStack for the current context using recordCall
    call_stack = recordCall()
    layout = pytestSystem.layout

    # Using CommentTracker to check for writable comments
    if pytestSystem._comment_tracker.hasWritableComment(call_stack, layout):
        # Extracting the comment and its line number
        typed_path = TypedPath(full_file_path)
        comment_str, line_number = CommentTracker.commentString(typed_path)
        # Removing the selfieonce comment
        test_code = test_code.replace(comment_str, '', 1)

    # Handling toBe_TODO() replacements 
    pattern_to_be = re.compile(r'expectSelfie\(\s*\"(.*?)\"\s*\)\.toBe_TODO\(\)', re.DOTALL)
    new_test_code = pattern_to_be.sub(lambda m: f"expectSelfie(\"{m.group(1)}\").toBe('{m.group(1)}')", new_test_code)

    # Handling toMatchDisk_TODO() replacements
    test_disk_start = new_test_code.find('def test_disk():')
    test_disk_end = new_test_code.find('def ', test_disk_start + 1)
    test_disk_code = new_test_code[test_disk_start:test_disk_end] if test_disk_end != -1 else new_test_code[test_disk_start:]

    pattern_to_match_disk = re.compile(r'expectSelfie\(\s*\"(.*?)\"\s*\)\.toMatchDisk_TODO\(\)', re.DOTALL)
    snapshot_file_path = full_file_path.parent / "SomethingOrOther.ss"

    # Extract and write the matched content to file 
    with snapshot_file_path.open("w") as snapshot_file:
        def write_snapshot(match):
            selfie_value = match.group(1)
            snapshot_content = f'expectSelfie("{selfie_value}").toMatchDisk("{selfie_value}")'
            snapshot_file.write(snapshot_content + "\n")
            return f'expectSelfie("{selfie_value}").toMatchDisk()'

        test_disk_code = pattern_to_match_disk.sub(write_snapshot, test_disk_code)

    # Update the test code for the 'test_disk' method
    if test_disk_end != -1:
        new_test_code = new_test_code[:test_disk_start] + test_disk_code + new_test_code[test_disk_end:]
    else:
        new_test_code = new_test_code[:test_disk_start] + test_disk_code

    if test_code != new_test_code:
        full_file_path.write_text(new_test_code)
        print(f"Updated test code in {full_file_path}")
    else:
        print("No changes made to the test code.")


@pytest.hookimpl(hookwrapper=True)
def pytest_pyfunc_call(pyfuncitem):
    outcome = yield
    try:
        result = outcome.get_result()
    except Exception as e:
        result = str(e)
        print(f"Test error: {pyfuncitem.nodeid} with {e}")

    # Store expected result if TODO was used and test passed
    if "TODO" in pyfuncitem.name and outcome.excinfo is None:
        expected_result = result
        pyfuncitem.todo_replace = {'expected': expected_result}
        replace_todo_in_test_file(pyfuncitem.nodeid, expected_result)

    print(f"SELFIE end test {pyfuncitem.nodeid} with {result}")
