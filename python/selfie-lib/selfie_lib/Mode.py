from enum import Enum, auto

from .WriteTracker import CallStack
from .CommentTracker import CommentTracker
from .SnapshotSystem import SnapshotSystem


class Mode(Enum):
    interactive = auto()
    readonly = auto()
    overwrite = auto()

    def can_write(self, is_todo: bool, call: CallStack, system: SnapshotSystem) -> bool:
        if self == Mode.interactive:
            return is_todo or system.source_file_has_writable_comment(call)
        elif self == Mode.readonly:
            if system.source_file_has_writable_comment(call):
                layout = system.layout
                path = layout.sourcePathForCall(call)
                comment, line = CommentTracker.commentString(path)
                raise system.fs.assert_failed(
                    f"Selfie is in readonly mode, so `{comment}` is illegal at {call.location.with_line(line).ide_link(layout)}"
                )
            return False
        elif self == Mode.overwrite:
            return True
        else:
            raise ValueError(f"Unknown mode: {self}")

    def msg_snapshot_not_found(self) -> str:
        return self.msg("Snapshot not found")

    def msg_snapshot_not_found_no_such_file(self, file) -> str:
        return self.msg(f"Snapshot not found: no such file {file}")

    def msg_snapshot_mismatch(self) -> str:
        return self.msg("Snapshot mismatch")

    def msg(self, headline: str) -> str:
        if self == Mode.interactive:
            return (
                f"{headline}\n"
                "- update this snapshot by adding '_TODO' to the function name\n"
                "- update all snapshots in this file by adding '//selfieonce' or '//SELFIEWRITE'"
            )
        elif self == Mode.readonly:
            return headline
        elif self == Mode.overwrite:
            return f"{headline}\n(didn't expect this to ever happen in overwrite mode)"
        else:
            raise ValueError(f"Unknown mode: {self}")
