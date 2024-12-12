# Welcome to pytest-selfie

A pytest plugin for selfie snapshot testing.

## Quick Start

1. Install pytest-selfie:
```bash
pip install pytest-selfie
```

2. Write a test:
```python
def test_my_function():
    result = my_function()
    assert_that(result).matches_snapshot()
```

3. Run the test:
```bash
pytest
```

The first time you run the test, it will fail because there's no snapshot. Add `_TODO` to the test name to create the snapshot:

```python
def test_my_function_TODO():
    result = my_function()
    assert_that(result).matches_snapshot()
```

Run the test again, and the snapshot will be created. Remove `_TODO` and run again to verify.

## Features

### Zero Setup Snapshot Testing
- No configuration required
- Works out of the box with pytest
- Automatic snapshot management
- Supports both inline and disk-based snapshots

### Inline and Disk-Based Snapshots
- Inline snapshots are stored directly in your test file
- Disk-based snapshots are stored in `.snapshot` directories
- Use `#selfieonce` or `#SELFIEWRITE` comments to update all snapshots in a file
- Use `--selfie-overwrite` flag to update all snapshots in the project

### Binary Data Support
- Handle binary data with built-in facets
- Support for common binary formats
- Custom binary facet creation
```python
def test_binary_data():
    data = get_binary_data()
    assert_that(data).as_binary().matches_snapshot()
```

### JSON Serialization
- Built-in JSON serialization support
- Pretty-printed JSON output
- Customizable JSON formatting
```python
def test_json_data():
    data = {"key": "value"}
    assert_that(data).as_json().matches_snapshot()
```

### Async/Coroutines Support
- Full support for async/await functions
- Cache async results for snapshot comparison
- Easy integration with async test frameworks
```python
async def test_async_function():
    result = await async_function()
    assert_that(result).matches_snapshot()

# Using cache_selfie_suspend for async operations
async def test_cached_async():
    cache = await cache_selfie_suspend(
        disk,
        roundtrip,
        async_value
    )
    assert cache.generator() == expected_value
```

## Advanced Usage

### Test File Annotations
- `#selfieonce`: Update all snapshots in the file once
- `#SELFIEWRITE`: Always update snapshots in the file
- Add `_TODO` to test names for one-time updates

### Command Line Options
- `--selfie-overwrite`: Update all snapshots in the project
- `--selfie-mode=readonly`: Prevent snapshot updates
- `--selfie-mode=interactive`: Default mode, allows updates with annotations

### Error Messages
Clear error messages guide you through snapshot management:
- Missing snapshots: Instructions for creating new snapshots
- Mismatched snapshots: Options for updating existing snapshots
- File not found: Guidance for creating snapshot files

## Best Practices
1. Keep snapshots focused and minimal
2. Use meaningful test names
3. Review snapshot changes carefully
4. Use `_TODO` for intentional updates
5. Commit snapshot files with your code
