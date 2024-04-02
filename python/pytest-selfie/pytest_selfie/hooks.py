import pytest


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config: Config):
    logging_settings(config)
