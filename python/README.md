The python implementation is under construction. It makes use of PEP 695, so you must use Python 3.12 or later.

Dependencies are managed using poetry, which you can install here.
- https://python-poetry.org/docs/#installing-with-the-official-installer
- then cd into `selfie-lib` and run `poetry install`

Our CI server runs three checks in the `selfie-lib` directory.

- `poetry run pytest -vv` this runs the tests (`-vv` makes nice output)
- `poetry run pyright` this does type checking
- `poetry run ruff check` this checks formatting

For the IDE we use VSCode. Make sure to open the `python` directory, not the parent `selfie`. Receommended VSCode plugins:

- https://marketplace.visualstudio.com/items?itemName=ms-python.python
- https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff