from dataclasses import dataclass, field
from typing import Optional, List, Dict
from datetime import datetime

@dataclass
class Article:
    """Модель статьи закона — только 4 поля"""
    code: str
    title: str
    text: str
    penalty: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "title": self.title,
            "text": self.text,
            "penalty": self.penalty
        }

@dataclass
class Codex:
    """Модель кодекса"""
    url: str
    articles: List[Article] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "articles": [article.to_dict() for article in self.articles]
        }

@dataclass
class ServerLaws:
    """Модель законов сервера"""
    server_name: str
    updated_at: int = field(default_factory=lambda: int(datetime.now().timestamp() * 1000))
    data: Dict[str, Codex] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "updatedAt": self.updated_at,
            "data": {key: codex.to_dict() for key, codex in self.data.items()}
        }