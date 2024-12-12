from collections.abc import Iterable
from threading import Lock

from .ArrayMap import ArrayMap, ArraySet
from .Snapshot import Snapshot


class WithinTestGC:
    def __init__(self):
        self.suffixes_to_keep = ArraySet.empty()
        self.lock = Lock()

    def keep_suffix(self, suffix: str):
        with self.lock:
            if self.suffixes_to_keep:
                self.suffixes_to_keep = self.suffixes_to_keep.plusOrThis(suffix)

    def keep_all(self) -> "WithinTestGC":
        with self.lock:
            self.suffixes_to_keep = None
        return self

    def __str__(self) -> str:
        with self.lock:
            return (
                str(self.suffixes_to_keep)
                if self.suffixes_to_keep is not None
                else "(null)"
            )

    def succeeded_and_used_no_snapshots(self) -> bool:
        with self.lock:
            return self.suffixes_to_keep == ArraySet.empty()

    def keeps(self, s: str) -> bool:
        with self.lock:
            return True if self.suffixes_to_keep is None else s in self.suffixes_to_keep

    @staticmethod
    def find_stale_snapshots_within(
        snapshots: ArrayMap[str, Snapshot],
        tests_that_ran: ArrayMap[str, "WithinTestGC"],
        tests_that_didnt_run: Iterable[str],
    ) -> list[int]:
        stale_indices = []

        # combine what we know about methods that did run with what we know about the tests that didn't
        total_gc = tests_that_ran
        for method in tests_that_didnt_run:
            total_gc = total_gc.plus(method, WithinTestGC().keep_all())

        gc_roots = total_gc.items()
        keys = snapshots.keys()
        # we'll start with the lowest gc, and the lowest key
        gc_idx = 0
        key_idx = 0
        while key_idx < len(keys) and gc_idx < len(gc_roots):
            key: str = keys[key_idx]  # type: ignore
            gc: tuple[str, WithinTestGC] = gc_roots[gc_idx]  # type: ignore
            if key.startswith(gc[0]):
                if len(key) == len(gc[0]):
                    # startWith + same length = exact match, no suffix
                    if not gc[1].keeps(""):
                        stale_indices.append(key_idx)
                    key_idx += 1
                    continue
                elif key[len(gc[0])] == "/":
                    # startWith + not same length = can safely query the `/`
                    suffix = key[len(gc[0]) :]
                    if not gc[1].keeps(suffix):
                        stale_indices.append(key_idx)
                    key_idx += 1
                    continue
                else:
                    # key is longer than gc.key, but doesn't start with gc.key, so we must increment gc
                    gc_idx += 1
                    continue
            else:
                # we don't start with the key, so we must increment
                if gc[0] < key:
                    gc_idx += 1
                else:
                    # we never found a gc that started with this key, so it's stale
                    stale_indices.append(key_idx)
                    key_idx += 1

        while key_idx < len(keys):
            stale_indices.append(key_idx)
            key_idx += 1

        return stale_indices
