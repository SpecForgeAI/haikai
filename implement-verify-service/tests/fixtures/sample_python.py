"""Sample file for ctags testing — known structure.

Module-level docstring — this is module-level content that
the chunker must NOT drop.
"""
from abc import ABC, abstractmethod
import os

# Module-level constant
CONSTANT_VALUE = 42
MAX_RETRIES = 3

class BaseService(ABC):
    @abstractmethod
    def execute(self) -> None:
        pass

class UserService(BaseService):
    def __init__(self, db):
        self.db = db

    def get_user(self, user_id: int):
        return self.db.query(user_id)

    def save_user(self, user) -> None:
        self.db.save(user)

    async def fetch_remote_user(self, url: str):
        pass

def standalone_function(x: int, y: int) -> int:
    return x + y

# Module-level statement between symbols
_registry = {}

def another_function():
    pass
