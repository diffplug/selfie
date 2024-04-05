from typing import Optional, Tuple
from selfie_lib import _initSelfieSystem, SnapshotSystem
import pytest


class PytestSnapshotSystem(SnapshotSystem):
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
    _initSelfieSystem(pytestSystem)


@pytest.hookimpl
def pytest_sessionfinish(session: pytest.Session, exitstatus):
    pytestSystem.finishedAllTests()


@pytest.hookimpl(hookwrapper=True)
def pytest_pyfunc_call(pyfuncitem: pytest.Function):
    # do_something_before_next_hook_executes()
    print("SELFIE start test {pytfuncitem.nodeid}")

    outcome = yield

    res = outcome.get_result()  # will raise if outcome was exception

    print("SELFIE end test {pytfuncitem.nodeid} with {Res}")
    # outcome.excinfo may be None or a (cls, val, tb) tuple
    # res = outcome.get_result()  # will raise if outcome was exception

    # post_process_result(res)

    # outcome.force_result(new_res)  # to override the return value to the plugin system
