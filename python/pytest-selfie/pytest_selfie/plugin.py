from cgi import test
import os
from collections import defaultdict
import re
from typing import ByteString, DefaultDict, List, Optional, Iterator

from selfie_lib.Atomic import AtomicReference
from .SelfieSettingsAPI import SelfieSettingsAPI
from selfie_lib import (
    _clearSelfieSystem,
    _initSelfieSystem,
    ArrayMap,
    ArraySet,
    CallStack,
    CommentTracker,
    DiskStorage,
    DiskWriteTracker,
    FS,
    InlineWriteTracker,
    LiteralValue,
    Mode,
    Snapshot,
    SnapshotFile,
    SnapshotFileLayout,
    SnapshotSystem,
    SnapshotValueReader,
    SourceFile,
    TypedPath,
    WithinTestGC,
)
import pytest


class FSImplementation(FS):
    def assert_failed(self, message: str, expected=None, actual=None) -> Exception:
        raise Exception(message)


class PytestSnapshotFileLayout(SnapshotFileLayout):
    def __init__(self, fs: FSImplementation, settings: SelfieSettingsAPI):
        super().__init__(fs)
        self.__settings = settings
        self.__root_folder = TypedPath.of_folder(os.path.abspath(settings.root_dir))
        self.unix_newlines = self.__infer_default_line_ending_is_unix()

    def snapshotfile_for_testfile(self, testfile: TypedPath) -> TypedPath:
        if testfile.name.endswith(".py"):
            return testfile.parent_folder().resolve_file(f"{testfile.name[:-3]}.ss")
        else:
            raise ValueError(f"Unknown file extension, expected .py: {testfile.name}")

    def __infer_default_line_ending_is_unix(self) -> bool:
        def walk_callback(walk: Iterator[TypedPath]) -> bool:
            for file_path in walk:
                try:
                    txt = self.fs.file_read(file_path)
                    # look for a file that has a newline somewhere in it
                    if "\n" in txt:
                        return "\r" not in txt
                except Exception:
                    # might be a binary file that throws an encoding exception
                    pass
            return True  # if we didn't find any files, assume unix

        return self.fs.file_walk(self.__root_folder, walk_callback)


@pytest.hookimpl
def pytest_collection_modifyitems(
    session: pytest.Session, config: pytest.Config, items: List[pytest.Item]
) -> None:
    settings = SelfieSettingsAPI(config)
    system = PytestSnapshotSystem(settings)
    session.selfie_system = system  # type: ignore
    _initSelfieSystem(system)
    for item in items:
        (file, _, testname) = item.reportinfo()
        system.planning_to_run(TypedPath.of_file(os.path.abspath(file)), testname)


@pytest.hookimpl
def pytest_sessionfinish(session: pytest.Session, exitstatus):
    system: PytestSnapshotSystem = session.selfie_system  # type: ignore
    system.finished_all_tests()
    _clearSelfieSystem(system)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item, nextitem: Optional[pytest.Item]):
    (file, _, testname) = item.reportinfo()
    testfile = TypedPath.of_file(os.path.abspath(file))

    system: PytestSnapshotSystem = item.session.system  # type: ignore
    system.test_start(testfile, testname)


@pytest.hookimpl(hookwrapper=True)
def pytest_pyfunc_call(pyfuncitem: pytest.Function):
    outcome = yield
    system: PytestSnapshotSystem = pyfuncitem.session.system  # type: ignore
    system.test_finished_and_failed(outcome.excinfo is not None)


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
        self.__mode = settings.calc_mode()
        self.__layout = PytestSnapshotFileLayout(self.__fs, settings)
        self.__comment_tracker = CommentTracker()
        self.__inline_write_tracker = InlineWriteTracker()
        # self.__toBeFileWriteTracker = ToBeFileWriteTracker() #TODO
        self.__progress_per_file: DefaultDict[TypedPath, SnapshotFileProgress] = (
            defaultdict(lambda key: SnapshotFileProgress(self, key))  # type: ignore
        )  # type: ignore
        # the test which is running right now, if any
        self.__in_progress: Optional[SnapshotFileProgress] = None
        # double-checks that we don't have any tests in progress
        self.check_for_invalid_state: AtomicReference[Optional[ArraySet[TypedPath]]] = (
            AtomicReference(ArraySet.empty())
        )

    def planning_to_run(self, testfile: TypedPath, testname: str):
        progress = self.__progress_per_file[testfile]
        progress.finishes_expected += 1

    def mark_path_as_written(self, path: TypedPath):
        def update_fun(arg: Optional[ArraySet[TypedPath]]):
            if arg is None:
                raise RuntimeError(
                    "Snapshot file is being written after all tests were finished."
                )
            return arg.plusOrThis(path)

        self.check_for_invalid_state.update_and_get(update_fun)

    def test_start(self, testfile: TypedPath, testname: str):
        if self.__in_progress is not None:
            raise RuntimeError("Test already in progress")
        self.__in_progress = self.__progress_per_file[testfile]
        self.__in_progress.test_start(testname)
        pass

    def test_finished_and_failed(self, failed: bool):
        if self.__in_progress is None:
            raise RuntimeError("No test in progress")
        self.__in_progress.test_finished_and_failed(failed)
        pass

    def finished_all_tests(self):
        snapshotsFilesWrittenToDisk = self.check_for_invalid_state.get_and_update(
            lambda _: None
        )
        if snapshotsFilesWrittenToDisk is None:
            raise RuntimeError("finished_all_tests() was called more than once.")
        if self.mode != Mode.readonly:
            for path in self.__comment_tracker.paths_with_once():
                source = SourceFile(path.name, self.fs.file_read(path))
                source.remove_selfie_once_comments()
                self.fs.file_write(path, source.as_string)
            if self.__inline_write_tracker.hasWrites():
                self.__inline_write_tracker.persist_writes(self.layout)

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


class SnapshotFileProgress:
    TERMINATED = ArrayMap.empty().plus(" ~ / f!n1shed / ~ ", WithinTestGC())

    def __init__(self, system: PytestSnapshotSystem, test_file: TypedPath):
        self.system = system
        # the test file which holds the test case which we are the snapshot file for
        self.test_file = test_file

        # before the tests run, we find out how many we expect to happen
        self.finishes_expected = 0
        # while the tests run, we count up until they have all run, and then we can cleanup
        self.finishes_so_far = 0
        # have any tests failed?
        self.has_failed = False

        # lazy-loaded snapshot file
        self.file: Optional[SnapshotFile] = None
        self.tests: AtomicReference[ArrayMap[str, WithinTestGC]] = AtomicReference(
            ArrayMap.empty()
        )
        self.disk_write_tracker: Optional[DiskWriteTracker] = DiskWriteTracker()
        # the test name which is currently in progress, if any
        self.testname_in_progress: Optional[str] = None

    def assert_not_terminated(self):
        if self.tests.get() == SnapshotFileProgress.TERMINATED:
            raise RuntimeError(
                "Cannot call methods on a terminated SnapshotFileProgress"
            )

    def test_start(self, testname: str):
        if "/" in testname:
            raise ValueError(f"Test name cannot contain '/', was {test}")
        self.assert_not_terminated()
        if self.testname_in_progress is not None:
            raise RuntimeError(
                f"Cannot start a new test {testname}, {self.testname_in_progress} is already in progress"
            )
        self.testname_in_progress = testname
        self.tests.update_and_get(lambda it: it.plus_or_noop(testname, WithinTestGC()))

    def test_finished_and_failed(self, failed: bool):
        self.assert_not_terminated()
        if self.testname_in_progress is None:
            raise RuntimeError("Can't finish, no test was in progress!")
        self.finishes_so_far += 1
        if failed:
            self.has_failed = True
            self.tests.get()[self.testname_in_progress].keep_all()
        self.testname_in_progress = None

        if self.finishes_so_far == self.finishes_expected:
            self.__all_tests_finished()

    def __all_tests_finished(self):
        self.assert_not_terminated()
        self.disk_write_tracker = None  # don't need this anymore
        tests = self.tests.get_and_update(lambda _: SnapshotFileProgress.TERMINATED)
        if tests == SnapshotFileProgress.TERMINATED:
            raise ValueError(f"Snapshot for {self.test_file} already terminated!")
        if self.file is not None:
            stale_snapshot_indices = WithinTestGC.find_stale_snapshots_within(
                self.file.snapshots,
                tests,
                find_test_methods_that_didnt_run(self.test_file, tests),
            )
            if stale_snapshot_indices or self.file.was_set_at_test_time:
                self.file.remove_all_indices(stale_snapshot_indices)
                snapshot_path = self.system.__layout.snapshotfile_for_testfile(
                    self.test_file
                )
                if not self.file.snapshots:
                    delete_file_and_parent_dir_if_empty(snapshot_path)
                else:
                    self.system.mark_path_as_written(
                        self.system.__layout.snapshotfile_for_testfile(self.test_file)
                    )
                    os.makedirs(
                        os.path.dirname(snapshot_path.absolute_path), exist_ok=True
                    )
                    with open(
                        snapshot_path.absolute_path, "w", encoding="utf-8"
                    ) as writer:
                        list = []
                        self.file.serialize(list)
                        for e in list:
                            writer.write(e)
        else:
            # we never read or wrote to the file
            every_test_in_class_ran = not any(
                find_test_methods_that_didnt_run(self.test_file, tests)
            )
            is_stale = (
                every_test_in_class_ran
                and not self.has_failed
                and all(it.succeeded_and_used_no_snapshots() for it in tests.values())
            )
            if is_stale:
                snapshot_file = self.system.__layout.snapshotfile_for_testfile(
                    self.test_file
                )
                delete_file_and_parent_dir_if_empty(snapshot_file)
        # now that we are done, allow our contents to be GC'ed
        self.file = None

    def keep(self, test: str, suffix_or_all: Optional[str]):
        self.assert_not_terminated()
        if suffix_or_all is None:
            self.tests.get()[test].keep_all()
        else:
            self.tests.get()[test].keep_suffix(suffix_or_all)

    def write(
        self,
        test: str,
        suffix: str,
        snapshot: Snapshot,
        call_stack: CallStack,
        layout: SnapshotFileLayout,
    ):
        self.assert_not_terminated()
        key = f"{test}{suffix}"
        self.disk_write_tracker.record(key, snapshot, call_stack, layout)  # type: ignore
        self.tests.get()[test].keep_suffix(suffix)
        self.read_file().set_at_test_time(key, snapshot)

    def read(self, test: str, suffix: str) -> Optional[Snapshot]:
        self.assert_not_terminated()
        snapshot = self.read_file().snapshots.get(f"{test}{suffix}")
        if snapshot is not None:
            self.tests.get()[test].keep_suffix(suffix)
        return snapshot

    def read_file(self) -> SnapshotFile:
        if self.file is None:
            snapshot_path = self.system.__layout.snapshotfile_for_testfile(
                self.test_file
            )
            if os.path.exists(snapshot_path.absolute_path) and os.path.isfile(
                snapshot_path.absolute_path
            ):
                with open(snapshot_path.absolute_path, "rb") as f:
                    content = f.read()
                self.file = SnapshotFile.parse(SnapshotValueReader.of_binary(content))
            else:
                self.file = SnapshotFile.create_empty_with_unix_newlines(
                    self.system.__layout.unix_newlines
                )
        return self.file


def delete_file_and_parent_dir_if_empty(snapshot_file: TypedPath):
    if os.path.isfile(snapshot_file.absolute_path):
        os.remove(snapshot_file.absolute_path)
        # if the parent folder is now empty, delete it
        parent = os.path.dirname(snapshot_file.absolute_path)
        if not os.listdir(parent):
            os.rmdir(parent)


def find_test_methods_that_didnt_run(
    testfile: TypedPath, tests: ArrayMap[str, WithinTestGC]
) -> ArrayMap[str, WithinTestGC]:
    # Implementation of finding test methods that didn't run
    # You can replace this with your own logic based on the class_name and tests dictionary
    return ArrayMap.empty()


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
