- High-level documentation - [selfie.dev](https://selfie.dev/py/get-started).
- API documentation - [pydoc.selfie.dev](https://pydoc.selfie.dev/namespaces).
- Source code - [github.com/diffplug/selfie](https://github.com/diffplug/selfie)

## Contributing

Dependencies are managed using uv:
- Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
- Then cd into each directory and run:
  - Install: uv pip install -r requirements.txt -r dev-requirements.txt
  - Tests: ./scripts/run-tests.sh
  - Type checking: ./scripts/run-typecheck.sh
  - Linting: ./scripts/run-lint.sh
  - Auto-fix formatting: uv python -m ruff format && uv python -m ruff check --fix

Our CI server runs these checks for all Python packages (`selfie-lib`, `pytest-selfie`, and `example-pytest-selfie`).

For the IDE we use VSCode. Make sure to open the `python` directory, not the parent `selfie`. Recommended VSCode plugins:

- https://marketplace.visualstudio.com/items?itemName=ms-python.python
- https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff
