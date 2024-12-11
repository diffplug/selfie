#!/bin/bash
uv pip install ruff
python -m ruff format --check && python -m ruff check
