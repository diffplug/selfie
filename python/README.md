- High-level documentation - [selfie.dev](https://selfie.dev/py/get-started).
- API documentation - [pydoc.selfie.dev](https://pydoc.selfie.dev/namespaces).
- Source code - [github.com/diffplug/selfie](https://github.com/diffplug/selfie)

## Contributing

Dependencies are managed using Python's venv and uv:

1. Create and activate virtual environment:
   ```bash
   python -m venv .venv
   # On Windows:
   .venv\Scripts\activate
   # On Unix:
   source .venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   python -m pip install --upgrade pip
   pip install uv
   uv pip install -r requirements.txt -r dev-requirements.txt
   ```

3. Run checks:
   ```bash
   python -m pytest -vv
   python -m pyright
   python -m ruff format --check && python -m ruff check
   ```
   - To fix formatting: `python -m ruff format && python -m ruff check --fix`

Our CI server runs these checks for all Python packages (`selfie-lib`, `pytest-selfie`, and `example-pytest-selfie`).

For the IDE we use VSCode. Make sure to open the `python` directory, not the parent `selfie`. Recommended VSCode plugins:

- https://marketplace.visualstudio.com/items?itemName=ms-python.python
- https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff
