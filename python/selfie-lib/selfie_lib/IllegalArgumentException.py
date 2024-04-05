from typing import Optional, Union


class IllegalArgumentException(ValueError):
    def __init__(
        self,
        message: Optional[str] = None,
        cause: Optional[Union[Exception, None]] = None,
    ) -> None:
        super().__init__(message)
        self.cause: Optional[Exception] = cause
