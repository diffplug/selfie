# Selfie snapshot testing for Python

- High-level documentation - [selfie.dev](https://selfie.dev/py/get-started).
- API documentation - [pydoc.selfie.dev](https://pydoc.selfie.dev/namespaces).
- Source code - [github.com/diffplug/selfie](https://github.com/diffplug/selfie)

## Contributing

PR's welcome! Dependencies are managed using uv:

- https://docs.astral.sh/uv/getting-started/installation/
- then cd into `selfie-lib` and run `uv sync` to get the dependencies

Our CI server runs three checks in the `selfie-lib` directory.

- `uv run pytest` - run tests
- `uv run pyright` - type checking
- `uv run ruff format --check && uv run ruff check` - code lint & formatting
  - `uv run ruff format && uv run ruff check --fix` to fix

The same setup is used for `pytest-selfie` and `example-pytest-selfie`.

For the IDE we use VSCode. Make sure to open the `python` directory, not the parent `selfie`. Recommended VSCode plugins:

- https://marketplace.visualstudio.com/items?itemName=ms-python.python
- https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff
