- High-level documentation - [selfie.dev](https://selfie.dev/py/get-started).
- API documentation - [pydoc.selfie.dev](https://pydoc.selfie.dev/namespaces).
- Source code - [github.com/diffplug/selfie](https://github.com/diffplug/selfie)

## Contributing

Dependencies are managed using poetry:

- https://python-poetry.org/docs/#installing-with-the-official-installer
- then cd into `selfie-lib` and run `poetry install`

Our CI server runs three checks in the `selfie-lib` directory.

- `poetry run pytest` - run tests
- `poetry run pyright` - type checking
- `poetry run ruff check` - code formatting
  - `poetry run ruff format` to fix any problems that `check` found

The same setup is used for `pytest-selfie` and `example-pytest-selfie`.

For the IDE we use VSCode. Make sure to open the `python` directory, not the parent `selfie`. Recommended VSCode plugins:

- https://marketplace.visualstudio.com/items?itemName=ms-python.python
- https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff
