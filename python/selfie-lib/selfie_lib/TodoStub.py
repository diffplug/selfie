from dataclasses import dataclass


@dataclass
class TodoStubMethod:
    name: str

    def create_literal(self) -> str:
        return f"_{self.name}()"


@dataclass
class TodoStub:
    to_be_file = TodoStubMethod("toBeFile")
    to_be_base64 = TodoStubMethod("toBeBase64")
