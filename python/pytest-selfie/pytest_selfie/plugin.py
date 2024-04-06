from typing import Optional, Tuple
from selfie_lib import _initSelfieSystem, SnapshotSystem
from selfie_lib import FS, SnapshotFile, DiskStorage, CallStack, LiteralValue, recordCall, Mode
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
        return None

    def write_disk(self, actual: SnapshotFile, sub: str, call: CallStack):
        pass

    def keep(self, sub_or_keep_all: Optional[str]):
        pass

    def recordCall(self, callerFileOnly: bool = False) -> CallStack:
        return recordCall(callerFileOnly)

class SnapshotFileLayoutImplementation(SnapshotFile):
    pass

class PytestSnapshotSystem(SnapshotSystem):
    def __init__(self):
        self._mode = Mode(can_write=True)

    @property
    def mode(self) -> Mode:
        return self._mode

    @property
    def fs(self) -> FS:
        return FSImplementation()

    @property
    def layout(self) -> SnapshotFile:
        return SnapshotFileLayoutImplementation()

    def diskThreadLocal(self) -> DiskStorage:
        return DiskStorageImplementation()

    def source_file_has_writable_comment(self, call: CallStack) -> bool:
        return True

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
    global pytestSystem
    _initSelfieSystem(pytestSystem)

@pytest.hookimpl
def pytest_sessionfinish(session: pytest.Session, exitstatus):
    update_test_files(session)
    print("SELFIE SESSION FINISHED")
    pytestSystem.finishedAllTests()

def update_test_files(session):
    for test in session.items:
        if getattr(test, 'todo_replace', None):
            replace_todo_in_test_file(test.nodeid, test.todo_replace['expected'])

def replace_todo_in_test_file(test_id, expected):
    file_path, test_name = test_id.split("::")
    file_path = Path(file_path)
    test_code = file_path.read_text()
    
    new_test_code = re.sub(
        r"(toBe_TODO\(\))",
        f"toBe('{expected}')",
        test_code
    )
    
    file_path.write_text(new_test_code)

@pytest.hookimpl(hookwrapper=True)
def pytest_pyfunc_call(pyfuncitem: pytest.Function):
    # do_something_before_next_hook_executes()
    print(f"SELFIE start test {pyfuncitem.nodeid}")

    outcome = yield

    res = outcome.get_result()  # will raise if outcome was exception

    print(f"SELFIE end test {pyfuncitem.nodeid} with {res}")
    
    # outcome.excinfo may be None or a (cls, val, tb) tuple
    # res = outcome.get_result()  # will raise if outcome was exception

    # post_process_result(res)

    # outcome.force_result(new_res)  # to override the return value to the plugin system

    # Store expected result if TODO was used and test passed
    if "TODO" in pyfuncitem.name and outcome.excinfo is None:
        pyfuncitem.todo_replace = {'expected': res}
        replace_todo_in_test_file(pyfuncitem.nodeid, res) 
