import os
from pathlib import Path
from typing import Any, Optional
import pytest
from _pytest.config import Config
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

def test_snapshot_system_initialization(tmp_path):
    config = MockConfig(Path(tmp_path))
    settings = SelfieSettingsAPI(config)
    system = PytestSnapshotSystem(settings)
    assert system.mode == Mode.interactive
    assert isinstance(system.fs, object)

def test_snapshot_file_layout(tmp_path):
    config = MockConfig(Path(tmp_path))
    settings = SelfieSettingsAPI(config)
    system = PytestSnapshotSystem(settings)
    test_file = TypedPath.of_file(os.path.join(str(tmp_path), "test_example.py"))
    snapshot_file = system.layout.get_snapshot_file(test_file)
    assert str(snapshot_file).endswith("test_example.ss")

def test_snapshot_system_mode_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv('SELFIE', 'readonly')
    config = MockConfig(Path(tmp_path))
    settings = SelfieSettingsAPI(config)
    system = PytestSnapshotSystem(settings)
    assert system.mode == Mode.readonly
