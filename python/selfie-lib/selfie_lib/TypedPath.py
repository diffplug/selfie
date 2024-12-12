from functools import total_ordering
import os.path


@total_ordering
class TypedPath:
    def __init__(self, absolute_path: str):
        # Normalize path separators for internal storage
        normalized = os.path.normpath(absolute_path)
        # Convert to forward slashes and ensure proper trailing slash
        path = normalized.replace("\\", "/")
        self.absolute_path = path.rstrip("/") + "/" if absolute_path.endswith(("/", "\\")) else path

    def __hash__(self):
        return hash(self.absolute_path)

    def __str__(self) -> str:
        return self.absolute_path

    @property
    def name(self) -> str:
        if self.absolute_path.endswith("/"):
            path = self.absolute_path[:-1]
        else:
            path = self.absolute_path
        last_slash = path.rfind("/")
        return path[last_slash + 1 :]

    @property
    def is_folder(self) -> bool:
        return self.absolute_path.endswith("/")

    def assert_folder(self) -> None:
        if not self.is_folder:
            raise AssertionError(
                f"Expected {self} to be a folder but it doesn't end with `/`"
            )

    def parent_folder(self) -> "TypedPath":
        if self.absolute_path == "/":
            raise ValueError("Path does not have a parent folder")
        trimmed_path = self.absolute_path.rstrip("/")
        last_idx = trimmed_path.rfind("/")
        return TypedPath.of_folder(trimmed_path[: last_idx + 1])

    def resolve_file(self, child: str) -> "TypedPath":
        self.assert_folder()
        if child.startswith("/") or child.endswith("/"):
            raise ValueError("Child path is not valid for file resolution")
        normalized_child = os.path.normpath(child)
        joined_path = os.path.join(self.absolute_path.rstrip("/"), normalized_child)
        return self.of_file(joined_path)

    def resolve_folder(self, child: str) -> "TypedPath":
        self.assert_folder()
        if child.startswith("/"):
            raise ValueError("Child path starts with a slash")
        normalized_child = os.path.normpath(child.rstrip("/"))
        joined_path = os.path.join(self.absolute_path.rstrip("/"), normalized_child)
        return self.of_folder(joined_path)

    def relativize(self, child: "TypedPath") -> str:
        self.assert_folder()
        if not child.absolute_path.startswith(self.absolute_path):
            raise ValueError(f"Expected {child} to start with {self.absolute_path}")
        return child.absolute_path[len(self.absolute_path) :]

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, TypedPath):
            return NotImplemented
        return self.absolute_path == other.absolute_path

    def __lt__(self, other: "TypedPath") -> bool:
        return self.absolute_path < other.absolute_path

    @classmethod
    def of_folder(cls, path: str) -> "TypedPath":
        normalized = os.path.normpath(path).replace("\\", "/")
        return cls(normalized + "/")

    @classmethod
    def of_file(cls, path: str) -> "TypedPath":
        normalized = os.path.normpath(path)
        if normalized.endswith("/"):
            raise ValueError("Expected path to not end with a slash for a file")
        return cls(normalized)
