class Language:
    PYTHON = "PYTHON"

    @classmethod
    def from_filename(cls, filename: str) -> str:
        extension = filename.rsplit(".", 1)[-1]
        if extension == "py":
            return cls.PYTHON
        else:
            raise ValueError(f"Unknown language for file {filename}")
