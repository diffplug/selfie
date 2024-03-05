from typing import Dict, Iterable, Tuple
from enum import Enum, auto
from collections import defaultdict
import threading
from selfie_lib.TypedPath import TypedPath
from selfie_lib.Slice import Slice


# Placeholder implementations for CallStack, SnapshotFileLayout, and FS
class CallStack:
    pass


class SnapshotFileLayout:
    def sourcePathForCall(self, location) -> "TypedPath":
        # Placeholder return or raise NotImplementedError
        raise NotImplementedError("sourcePathForCall is not implemented")


class FS:
    def fileRead(self, typedPath: "TypedPath") -> str:
        # Placeholder return or raise NotImplementedError
        raise NotImplementedError("fileRead is not implemented")


class WritableComment(Enum):
    NO_COMMENT = auto()
    ONCE = auto()
    FOREVER = auto()

    @property
    def writable(self) -> bool:
        return self != WritableComment.NO_COMMENT


class CommentTracker:
    def __init__(self):
        self.cache: Dict[TypedPath, WritableComment] = defaultdict(
            lambda: WritableComment.NO_COMMENT
        )
        self.lock = threading.Lock()

    def pathsWithOnce(self) -> Iterable[TypedPath]:
        with self.lock:
            return [
                path
                for path, comment in self.cache.items()
                if comment == WritableComment.ONCE
            ]

    # def hasWritableComment(self, call: CallStack, layout: SnapshotFileLayout) -> bool:
    def hasWritableComment(
        self, call: CallStack, layout: SnapshotFileLayout, fs: FS
    ) -> bool:
        path = layout.sourcePathForCall(call)
        with self.lock:
            comment = self.cache.get(path)
            if comment and comment.writable:
                return True
            else:
                new_comment, _ = self.commentAndLine(path, fs)
                self.cache[path] = new_comment
                return new_comment.writable

    @staticmethod
    def commentString(typedPath: TypedPath, fs: FS) -> Tuple[str, int]:
        comment, line = CommentTracker.commentAndLine(typedPath, fs)
        if comment == WritableComment.NO_COMMENT:
            raise ValueError("No writable comment found")
        elif comment == WritableComment.ONCE:
            return ("//selfieonce", line)
        elif comment == WritableComment.FOREVER:
            return ("//SELFIEWRITE", line)
        else:
            raise ValueError("Invalid comment type")

    @staticmethod
    def commentAndLine(typedPath: TypedPath, fs: FS) -> Tuple[WritableComment, int]:
        content = Slice(fs.fileRead(typedPath))
        for comment_str in [
            "//selfieonce",
            "// selfieonce",
            "//SELFIEWRITE",
            "// SELFIEWRITE",
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
