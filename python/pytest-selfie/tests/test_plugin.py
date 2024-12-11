import os
import pytest
from _pytest.config import Config
from pathlib import Path
from typing import Any

from pytest_selfie.plugin import PytestSnapshotSystem, SelfieSettingsAPI
from selfie_lib import Mode, TypedPath


class MockConfig(Config):  # type: ignore
    def __init__(self, tmp_path: Path):
        self._rootpath = tmp_path

    def getoption(self, name: str, default: Any = None, skip: bool = False) -> Any:
        return default

    @property
    def rootpath(self) -> Path:
        return self._rootpath


@pytest.fixture()
def mock_config(tmp_path: Path) -> MockConfig:
    """Create a mock config for testing."""
    return MockConfig(tmp_path)


def test_snapshot_system_initialization(mock_config):  # type: ignore[misc]
    settings = SelfieSettingsAPI(mock_config)
    system = PytestSnapshotSystem(settings)
    assert system.mode == Mode.interactive
    assert isinstance(system.fs, object)


def test_snapshot_file_layout(mock_config):  # type: ignore[misc]
    settings = SelfieSettingsAPI(mock_config)
    system = PytestSnapshotSystem(settings)
    test_file = TypedPath.of_file(
        os.path.join(str(mock_config.rootpath), "test_example.py")
    )
    snapshot_file = system.layout.get_snapshot_file(test_file)
    assert str(snapshot_file).endswith("test_example.ss")


def test_snapshot_system_mode_from_env(mock_config, monkeypatch):  # type: ignore[misc]
    monkeypatch.setenv("SELFIE", "readonly")
    settings = SelfieSettingsAPI(mock_config)
    system = PytestSnapshotSystem(settings)
    assert system.mode == Mode.readonly
