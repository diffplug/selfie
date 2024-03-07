from functools import total_ordering


@total_ordering
class TypedPath:
    def __init__(self, absolute_path: str):
        self.absolute_path = absolute_path

    def __hash__(self):
        return hash(self.absolute_path)

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
        return self.of_file(f"{self.absolute_path}{child}")

    def resolve_folder(self, child: str) -> "TypedPath":
        self.assert_folder()
        if child.startswith("/"):
            raise ValueError("Child path starts with a slash")
        return self.of_folder(f"{self.absolute_path}{child}/")

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
        unix_path = path.replace("\\", "/")
        if not unix_path.endswith("/"):
            unix_path += "/"
        return cls(unix_path)

    @classmethod
    def of_file(cls, path: str) -> "TypedPath":
        unix_path = path.replace("\\", "/")
        if unix_path.endswith("/"):
            raise ValueError("Expected path to not end with a slash for a file")
        return cls(unix_path)
