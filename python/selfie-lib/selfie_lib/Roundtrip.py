from typing import Any, Generic, TypeVar

# Define generic type variables
T = TypeVar("T")
SerializedForm = TypeVar("SerializedForm")


class Roundtrip(Generic[T, SerializedForm]):
    def serialize(self, value: T) -> SerializedForm:
        """Serialize a value of type T to its SerializedForm."""
        raise NotImplementedError

    def parse(self, serialized: SerializedForm) -> T:
        """Parse the SerializedForm back to type T."""
        raise NotImplementedError

    @classmethod
    def identity(cls) -> "Roundtrip[T, T]":
        """Return an identity Roundtrip that does no transformation."""

        class Identity(Roundtrip[Any, Any]):
            def serialize(self, value: Any) -> Any:
                return value

            def parse(self, serialized: Any) -> Any:
                return serialized

        return Identity()

    @classmethod
    def json(cls) -> "Roundtrip[T, str]":
        """Return a Roundtrip that serializes to/from JSON strings."""
        import json

        class JsonRoundtrip(Roundtrip[Any, str]):
            def serialize(self, value: Any) -> str:
                return json.dumps(value, indent=4)

            def parse(self, serialized: str) -> Any:
                return json.loads(serialized)

        return JsonRoundtrip()
