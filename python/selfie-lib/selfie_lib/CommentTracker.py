import threading
from collections.abc import Iterable
from enum import Enum, auto

from .Slice import Slice
from .TypedPath import TypedPath
from .WriteTracker import CallStack, SnapshotFileLayout


class WritableComment(Enum):
    NO_COMMENT = auto()
    ONCE = auto()
    FOREVER = auto()

    @property
    def writable(self) -> bool:
        return self != WritableComment.NO_COMMENT


class CommentTracker:
    def __init__(self):
        self.cache: dict[TypedPath, WritableComment] = {}
        self.lock = threading.Lock()

    def paths_with_once(self) -> Iterable[TypedPath]:
        with self.lock:
            return [
                path
                for path, comment in self.cache.items()
                if comment == WritableComment.ONCE
            ]

    def hasWritableComment(self, call: CallStack, layout: SnapshotFileLayout) -> bool:
        path = layout.sourcefile_for_call(call.location)
        with self.lock:
            if path in self.cache:
                return self.cache[path].writable
            else:
                new_comment, _ = self.__commentAndLine(path)
                self.cache[path] = new_comment
                return new_comment.writable

    @staticmethod
    def commentString(typedPath: TypedPath) -> tuple[str, int]:
        comment, line = CommentTracker.__commentAndLine(typedPath)
        if comment == WritableComment.NO_COMMENT:
            raise ValueError("No writable comment found")
        elif comment == WritableComment.ONCE:
            return ("#selfieonce", line)
        elif comment == WritableComment.FOREVER:
            return ("#SELFIEWRITE", line)
        else:
            raise ValueError("Invalid comment type")

    @staticmethod
    def __commentAndLine(typedPath: TypedPath) -> tuple[WritableComment, int]:
        with open(typedPath.absolute_path, encoding="utf-8") as file:
            content = Slice(file.read())
        for comment_str in [
            "# selfieonce",
            "#selfieonce",
            "# SELFIEWRITE",
            "#SELFIEWRITE",
        ]:
            index = content.indexOf(comment_str)
            if index != -1:
                lineNumber = content.baseLineAtOffset(index)
                comment = (
                    WritableComment.ONCE
                    if "once" in comment_str
                    else WritableComment.FOREVER
                )
                return (comment, lineNumber)
        return (WritableComment.NO_COMMENT, -1)
