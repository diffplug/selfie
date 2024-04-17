import os
from pathlib import Path
from typing import Optional
from selfie_lib import Mode


def calc_mode():
    override = os.getenv("selfie") or os.getenv("SELFIE")
    if override:
        # Convert the mode to lowercase and match it with the Mode enum
        try:
            return Mode[override.lower()]
        except KeyError:
            raise ValueError(f"No such mode: {override}")

    ci = os.getenv("ci") or os.getenv("CI")
    if ci and ci.lower() == "true":
        return Mode.readonly
    else:
        return Mode.interactive


class SelfieSettingsAPI:
    STANDARD_DIRS = ["tests"]

    @property
    def allow_multiple_equivalent_writes_to_one_location(self) -> bool:
        """Allow multiple equivalent writes to one location."""
        return True

    @property
    def snapshot_folder_name(self) -> Optional[str]:
        """Defaults to None, which means that snapshots are stored right next to the test that created them."""
        return None

    @property
    def root_folder(self) -> Path:
        """Returns the root folder for storing snapshots."""
        user_dir = Path(os.getcwd())
        for standard_dir in self.STANDARD_DIRS:
            candidate = user_dir / standard_dir
            if candidate.is_dir():
                return candidate
        raise AssertionError(
            f"Could not find a standard test directory, 'user.dir' is equal to {user_dir}, looked in {self.STANDARD_DIRS}"
        )

    @property
    def other_source_roots(self) -> list[Path]:
        """List of other source roots that should be considered besides the root folder."""
        source_roots = []
        root_dir = self.root_folder
        user_dir = Path(os.getcwd())
        for standard_dir in self.STANDARD_DIRS:
            candidate = user_dir / standard_dir
            if candidate.is_dir() and candidate != root_dir:
                source_roots.append(candidate)
        return source_roots


class SelfieSettingsSmuggleError(SelfieSettingsAPI):
    def __init__(self, error: BaseException):
        self.error = error
