import pytest
from selfie_lib.TypedPath import TypedPath


def test_initialization():
    path = TypedPath("/home/user/")
    assert path.absolute_path == "/home/user/"
    assert path.is_folder
    assert path.name == "user"


def test_parent_folder():
    path = TypedPath("/home/user/documents/")
    parent = path.parent_folder()
    assert isinstance(parent, TypedPath)
    assert parent.absolute_path == "/home/user/"


def test_resolve_file():
    folder = TypedPath("/home/user/")
    file = folder.resolve_file("document.txt")
    assert file.absolute_path == "/home/user/document.txt"
    assert not file.is_folder
    assert file.name == "document.txt"


def test_resolve_folder():
    folder = TypedPath("/home/user/")
    subfolder = folder.resolve_folder("documents")
    assert subfolder.absolute_path == "/home/user/documents/"
    assert subfolder.is_folder
    assert subfolder.name == "documents"


def test_relativize():
    folder = TypedPath("/home/user/")
    file = TypedPath("/home/user/document.txt")
    relative_path = folder.relativize(file)
    assert relative_path == "document.txt"


def test_of_folder_class_method():
    folder = TypedPath.of_folder("/home/user/documents")
    assert folder.absolute_path == "/home/user/documents/"
    assert folder.is_folder


def test_of_file_class_method():
    file = TypedPath.of_file("/home/user/document.txt")
    assert file.absolute_path == "/home/user/document.txt"
    assert not file.is_folder


def test_assert_folder_failure():
    with pytest.raises(AssertionError):
        file = TypedPath("/home/user/document.txt")
        file.assert_folder()


def test_parent_folder_failure():
    with pytest.raises(ValueError):
        path = TypedPath("/")
        path.parent_folder()


def test_equality():
    path1 = TypedPath("/home/user/")
    path2 = TypedPath("/home/user/")
    assert path1 == path2


def test_inequality():
    path1 = TypedPath("/home/user/")
    path2 = TypedPath("/home/another_user/")
    assert path1 != path2


def test_ordering():
    path1 = TypedPath("/home/a/")
    path2 = TypedPath("/home/b/")
    assert path1 < path2
    assert path2 > path1


def test_relativize_error():
    parent = TypedPath("/home/user/")
    child = TypedPath("/home/another_user/document.txt")
    with pytest.raises(ValueError):
        parent.relativize(child)
