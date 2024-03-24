from typing import Dict, Iterable, Tuple, Sequence, TypeVar, Callable
from abc import ABC, abstractmethod
from enum import Enum, auto
import threading

from selfie_lib.Slice import Slice
from selfie_lib.TypedPath import TypedPath
from selfie_lib.WriteTracker import CallStack, SnapshotFileLayout


class WritableComment(Enum):
    NO_COMMENT = auto()
    ONCE = auto()
    FOREVER = auto()

    @property
    def writable(self) -> bool:
        return self != WritableComment.NO_COMMENT


class CommentTracker:
    def __init__(self):
        self.cache: Dict[TypedPath, WritableComment] = {}
        self.lock = threading.Lock()

    def pathsWithOnce(self) -> Iterable[TypedPath]:
        with self.lock:
            return [
                path
                for path, comment in self.cache.items()
                if comment == WritableComment.ONCE
            ]

    def hasWritableComment(self, call: CallStack, layout: SnapshotFileLayout) -> bool:
        path = layout.sourcePathForCall(call)
        with self.lock:
            if path in self.cache:
                comment = self.cache[path]
                if comment.writable:
                    return True
                else:
                    return False
            else:
                new_comment, _ = self.__commentAndLine(path)
                self.cache[path] = new_comment
                return new_comment.writable

    @staticmethod
    def commentString(typedPath: TypedPath) -> Tuple[str, int]:
        comment, line = CommentTracker.__commentAndLine(typedPath)
        if comment == WritableComment.NO_COMMENT:
            raise ValueError("No writable comment found")
        elif comment == WritableComment.ONCE:
            return ("//selfieonce", line)
        elif comment == WritableComment.FOREVER:
            return ("//SELFIEWRITE", line)
        else:
            raise ValueError("Invalid comment type")

    @staticmethod
    def __commentAndLine(typedPath: TypedPath) -> Tuple[WritableComment, int]:
        with open(typedPath.absolute_path, "r") as file:
            content = Slice(file.read())
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
