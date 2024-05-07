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
- `poetry run ruff format --check && poetry run ruff check` - code lint & formatting
  - `poetry run ruff format && poetry run ruff --fix` to fix

The same setup is used for `pytest-selfie` and `example-pytest-selfie`.

For the IDE we use VSCode. Make sure to open the `python` directory, not the parent `selfie`. Recommended VSCode plugins:

- https://marketplace.visualstudio.com/items?itemName=ms-python.python
- https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff
