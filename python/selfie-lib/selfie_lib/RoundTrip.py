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
