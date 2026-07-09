from dataclasses import dataclass, field
from typing import List, Dict

@dataclass
class Config:
    """Конфигурация парсера Majestic RP Laws Parser"""
    
    # ============================================================ #
    # БАЗОВЫЕ НАСТРОЙКИ
    # ============================================================ #
    
    FORUM_URL: str = "https://forum.majestic-rp.ru/"
    BASE_URL: str = "https://forum.majestic-rp.ru/"
    
    # ============================================================ #
    # СПИСОК СЕРВЕРОВ (19 серверов Majestic RP)
    # ============================================================ #
    
    SERVERS: List[Dict[str, str]] = field(default_factory=lambda: [
        {"name": "New York", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-new-york.1/"},
        {"name": "Detroit", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-detroit.2/"},
        {"name": "Chicago", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-chicago.3/"},
        {"name": "San Francisco", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-san-francisco.4/"},
        {"name": "Atlanta", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-atlanta.5/"},
        {"name": "San Diego", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-san-diego.6/"},
        {"name": "Los Angeles", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-los-angeles.7/"},
        {"name": "Miami", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-miami.8/"},
        {"name": "Las Vegas", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-las-vegas.9/"},
        {"name": "Washington", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-washington.10/"},
        {"name": "Dallas", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-dallas.11/"},
        {"name": "Boston", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-boston.12/"},
        {"name": "Houston", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-houston.13/"},
        {"name": "Seattle", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-seattle.14/"},
        {"name": "Phoenix", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-phoenix.15/"},
        {"name": "Denver", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-denver.16/"},
        {"name": "Portland", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-portland.17/"},
        {"name": "Orlando", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/"},
        {"name": "Memphis", "url": "https://forum.majestic-rp.ru/forums/zakonodatelnaja-baza-memphis.19/"},
    ])
    
    # ============================================================ #
    # ТОЧНЫЕ НАЗВАНИЯ КОДЕКСОВ ДЛЯ ПОИСКА
    # ============================================================ #
    
    CODEX_TITLES: Dict[str, List[str]] = field(default_factory=lambda: {
        "UK": [
            "Уголовный кодекс",
            "Уголовный Кодекс",
            "Уголовный кодекс штата",
            "Уголовный Кодекс штата"
        ],
        "AK": [
            "Административный кодекс",
            "Административный Кодекс",
            "Административный кодекс штата",
            "Административный Кодекс штата"
        ],
        "PK": [
            "Процессуальный кодекс",
            "Процессуальный Кодекс",
            "Процессуальный кодекс штата",
            "Процессуальный Кодекс штата"
        ],
        "DK": [
            "Дорожный кодекс",
            "Дорожный Кодекс",
            "Дорожный кодекс штата",
            "Дорожный Кодекс штата"
        ]
    })
    
    # ============================================================ #
    # КЛЮЧЕВЫЕ СЛОВА ДЛЯ ПОИСКА (ЗАПАСНОЙ ВАРИАНТ)
    # ============================================================ #
    
    CODEX_KEYWORDS: Dict[str, List[str]] = field(default_factory=lambda: {
        "UK": ["уголовный кодекс", "ук", "уголовный", "Уголовный"],
        "AK": ["административный кодекс", "ак", "административный", "Административный"],
        "PK": ["процессуальный кодекс", "пк", "процессуальный", "Процессуальный"],
        "DK": ["дорожный кодекс", "дк", "дорожный", "Дорожный"]
    })
    
    # ============================================================ #
    # КЛЮЧЕВЫЕ СЛОВА ДЛЯ ПОИСКА РАЗДЕЛА "ЗАКОНОДАТЕЛЬНАЯ БАЗА"
    # ============================================================ #
    
    LAWS_FORUM_KEYWORDS: List[str] = field(default_factory=lambda: [
        "законодательн",
        "законы",
        "laws",
        "legislation",
        "законодательная база"
    ])
    
    # ============================================================ #
    # МАРКЕРЫ CLOUDFLARE ДЛЯ ДЕТЕКЦИИ
    # ============================================================ #
    
    CLOUDFLARE_MARKERS: List[str] = field(default_factory=lambda: [
        "cf-browser-verification",
        "Checking your browser",
        "Just a moment",
        "DDoS protection",
        "cloudflare",
        "Please wait"
    ])
    
    # ============================================================ #
    # НАСТРОЙКИ ПАРСИНГА
    # ============================================================ #
    
    REQUEST_DELAY: float = 1.0          # Задержка между запросами (сек)
    MAX_RETRIES: int = 5                # Максимум попыток при ошибке
    CONNECT_TIMEOUT: int = 30           # Таймаут соединения (сек)
    READ_TIMEOUT: int = 60              # Таймаут чтения (сек)
    
    # ============================================================ #
    # ПУТИ ДЛЯ СОХРАНЕНИЯ
    # ============================================================ #
    
    DATA_DIR: str = "data/laws"         # Папка для JSON-файлов
    REPORT_FILE: str = "data/report.json"  # Файл отчета

# Создаем глобальный экземпляр конфига
config = Config()