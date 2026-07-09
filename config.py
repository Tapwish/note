from dataclasses import dataclass, field
from typing import List, Dict

@dataclass
class Config:
    FORUM_URL: str = "https://forum.majestic-rp.ru/"
    BASE_URL: str = "https://forum.majestic-rp.ru/"
    
    # ================================================================
    # СПИСОК СЕРВЕРОВ (ВСЕ 19)
    # ================================================================
    SERVERS: List[Dict[str, str]] = field(default_factory=lambda: [
        {"name": "New York", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.84/"},
        {"name": "Detroit", "url": "https://forum.majestic-rp.ru/forums/kodeksy.353/"},
        {"name": "Chicago", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.255/"},
        {"name": "San Francisco", "url": "https://forum.majestic-rp.ru/forums/odobrennyye-zakonoproyekty.344/"},
        {"name": "Atlanta", "url": "https://forum.majestic-rp.ru/forums/odobrennyye-zakonoproyekty.562/"},
        {"name": "San Diego", "url": "https://forum.majestic-rp.ru/forums/normativno-pravovyye-akty.580/"},
        {"name": "Los Angeles", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.693/"},
        {"name": "Miami", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.773/"},
        {"name": "Las Vegas", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.820/"},
        {"name": "Washington", "url": "https://forum.majestic-rp.ru/forums/odobrennyye-zakonoproyekty.895/"},
        {"name": "Dallas", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.954/"},
        {"name": "Boston", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1017/"},
        {"name": "Houston", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1104/"},
        {"name": "Seattle", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1163/"},
        {"name": "Phoenix", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1213/"},
        {"name": "Denver", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1276/"},
        {"name": "Portland", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1338/"},
        {"name": "Orlando", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/"},
        {"name": "Memphis", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1471/"}
    ])
    
    # ================================================================
    # ТОЧНЫЕ НАЗВАНИЯ КОДЕКСОВ (ДЛЯ ПОИСКА)
    # ================================================================
    CODEX_TITLES: Dict[str, List[str]] = field(default_factory=lambda: {
        "UK": ["Уголовный кодекс", "Уголовный Кодекс"],
        "AK": ["Административный кодекс", "Административный Кодекс"],
        "PK": ["Процессуальный кодекс", "Процессуальный Кодекс"],
        "DK": ["Дорожный кодекс", "Дорожный Кодекс"]
    })
    
    # ================================================================
    # КЛЮЧЕВЫЕ СЛОВА (ДЛЯ ПОИСКА, ЕСЛИ ТОЧНОЕ НАЗВАНИЕ НЕ НАЙДЕНО)
    # ================================================================
    CODEX_KEYWORDS: Dict[str, List[str]] = field(default_factory=lambda: {
        "UK": ["уголовный"],
        "AK": ["административный"],
        "PK": ["процессуальный"],
        "DK": ["дорожный"]
    })
    
    # ================================================================
    # ПУТИ (СОЗДАЮТСЯ АВТОМАТИЧЕСКИ)
    # ================================================================
    DATA_DIR: str = "data/laws"
    REPORT_FILE: str = "data/report.json"
    
    # ================================================================
    # НАСТРОЙКИ ПАРСИНГА
    # ================================================================
    REQUEST_DELAY: float = 1.0
    MAX_RETRIES: int = 5
    CONNECT_TIMEOUT: int = 30
    READ_TIMEOUT: int = 60

config = Config()
