import json
from typing import Generic, TypeVar

T = TypeVar("T")


class RoundtripJson(Generic[T]):
    @staticmethod
    def of() -> "RoundtripJson[T]":
        return RoundtripJson()

    def to_string(self, value: T) -> str:
        return json.dumps(value, indent=2)

    def from_string(self, str_value: str) -> T:
        return json.loads(str_value)
