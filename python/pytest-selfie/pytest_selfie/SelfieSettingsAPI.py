import os
from pathlib import Path
from typing import Optional

import pytest
from selfie_lib import Mode


class SelfieSettingsAPI:
    """API for configuring the selfie plugin, you can set its values like this https://docs.pytest.org/en/7.1.x/reference/customize.html#configuration-file-formats"""

    def __init__(self, config: pytest.Config):
        self.root_dir = config.rootpath

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
        """Returns the root folder for storing snapshots. Set by https://docs.pytest.org/en/7.1.x/reference/customize.html#finding-the-rootdir"""
        return self.root_dir

    def calc_mode(self) -> Mode:
        override = os.getenv("selfie") or os.getenv("SELFIE")  # noqa: SIM112
        if override:
            # Convert the mode to lowercase and match it with the Mode enum
            try:
                return Mode[override.lower()]
            except KeyError:
                raise ValueError(f"No such mode: {override}") from None

        ci = os.getenv("ci") or os.getenv("CI")  # noqa: SIM112
        if ci and ci.lower() == "true":
            return Mode.readonly
        else:
            return Mode.interactive


class SelfieSettingsSmuggleError(SelfieSettingsAPI):
    def __init__(self, error: BaseException):
        self.error = error
