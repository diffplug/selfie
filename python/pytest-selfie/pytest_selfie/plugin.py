from typing import Optional, ByteString

from selfie_lib.FS import FS
from selfie_lib.WriteTracker import InlineWriteTracker

from .SelfieSettingsAPI import calc_mode, SelfieSettingsAPI
from .replace_todo import replace_todo_in_test_file, update_test_files
from selfie_lib import (
    ArrayMap,
    _initSelfieSystem,
    CallStack,
    CommentTracker,
    DiskStorage,
    LiteralValue,
    Mode,
    Snapshot,
    SnapshotFileLayout,
    SnapshotSystem,
    TypedPath,
)
import pytest


class FSImplementation(FS):
    def assert_failed(self, message: str, expected=None, actual=None) -> Exception:
        raise Exception(message)


class DiskStorageImplementation(DiskStorage):
    def read_disk(self, sub: str, call: CallStack) -> Optional[Snapshot]:
        print(f"Reading from disk: sub={sub}")
        return None

    def write_disk(self, actual: Snapshot, sub: str, call: CallStack):
        print(f"Writing to disk: {actual} at {sub}")

    def keep(self, sub_or_keep_all: Optional[str]):
        print(f"Keeping snapshot for: {sub_or_keep_all}")


class PytestSnapshotSystem(SnapshotSystem):
    def __init__(self, settings: SelfieSettingsAPI):
        self.__fs = FSImplementation()
        self.__mode = calc_mode()
        self.__layout = SnapshotFileLayout(self.__fs)
        self.__comment_tracker = CommentTracker()
        self.__inline_write_tracker = InlineWriteTracker()
        # self.__toBeFileWriteTracker = ToBeFileWriteTracker() #TODO
        self.__progress_per_file: ArrayMap[str, SnapshotFileProgress] = ArrayMap.empty()

    @property
    def mode(self) -> Mode:
        return self.__mode

    @property
    def fs(self) -> FS:
        return self.__fs

    @property
    def layout(self) -> SnapshotFileLayout:
        return self.__layout

    def disk_thread_local(self) -> DiskStorage:
        return DiskStorageImplementation()

    def source_file_has_writable_comment(self, call: CallStack) -> bool:
        return self.__comment_tracker.hasWritableComment(call, self.layout)

    def write_inline(self, literal_value: LiteralValue, call: CallStack):
        pass

    def write_to_be_file(
        self, path: TypedPath, data: "ByteString", call: CallStack
    ) -> None:
        pass

    def finishedAllTests(self):
        pass


pytestSystem = PytestSnapshotSystem(SelfieSettingsAPI())


class SnapshotFileProgress:
    pass


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
    replace_todo_in_test_file(pytestSystem, "tests/Simple_test.py::test_inline")
    _initSelfieSystem(pytestSystem)


@pytest.hookimpl
def pytest_sessionfinish(session: pytest.Session, exitstatus):
    print("SELFIE SESSION FINISHED")
    update_test_files(pytestSystem, session)
    pytestSystem.finishedAllTests()


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
        pyfuncitem.todo_replace = {"expected": expected_result}
        replace_todo_in_test_file(pyfuncitem.nodeid, expected_result)

    print(f"SELFIE end test {pyfuncitem.nodeid} with {result}")
