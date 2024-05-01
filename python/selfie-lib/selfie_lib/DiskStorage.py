from abc import ABC, abstractmethod
from typing import Optional
from selfie_lib import CallStack, Snapshot

class DiskStorage(ABC):
    @abstractmethod
    def read_disk(self, sub: str, call: 'CallStack') -> Optional['Snapshot']:
        pass

    @abstractmethod
    def write_disk(self, actual: 'Snapshot', sub: str, call: 'CallStack'):
        pass

    @abstractmethod
    def keep(self, sub_or_keep_all: Optional[str]):
        pass
