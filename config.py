# config.py

import os
from typing import List, Dict

class Config:
    BASE_URL: str = "https://forum.majestic-rp.ru/"
    
    # ================================================================
    # 🔥 ДАННЫЕ ДЛЯ АВТОРИЗАЦИИ
    # ================================================================
    FORUM_LOGIN: str = os.environ.get("FORUM_LOGIN", "")  # Твой логин на форуме
    FORUM_PASSWORD: str = os.environ.get("FORUM_PASSWORD", "")  # Твой пароль
    
    # ================================================================
    # ВСЕ 19 СЕРВЕРОВ
    # ================================================================
    SERVERS: List[Dict[str, str]] = [
        {"name": "New York", "id": "new-york", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.84/"},
        {"name": "Detroit", "id": "detroit", "url": "https://forum.majestic-rp.ru/forums/kodeksy.353/"},
        {"name": "Chicago", "id": "chicago", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.255/"},
        {"name": "San Francisco", "id": "san-francisco", "url": "https://forum.majestic-rp.ru/forums/odobrennyye-zakonoproyekty.344/"},
        {"name": "Atlanta", "id": "atlanta", "url": "https://forum.majestic-rp.ru/forums/odobrennyye-zakonoproyekty.562/"},
        {"name": "San Diego", "id": "san-diego", "url": "https://forum.majestic-rp.ru/forums/normativno-pravovyye-akty.580/"},
        {"name": "Los Angeles", "id": "los-angeles", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.693/"},
        {"name": "Miami", "id": "miami", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.773/"},
        {"name": "Las Vegas", "id": "las-vegas", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.820/"},
        {"name": "Washington", "id": "washington", "url": "https://forum.majestic-rp.ru/forums/odobrennyye-zakonoproyekty.895/"},
        {"name": "Dallas", "id": "dallas", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.954/"},
        {"name": "Boston", "id": "boston", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1017/"},
        {"name": "Houston", "id": "houston", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1104/"},
        {"name": "Seattle", "id": "seattle", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1163/"},
        {"name": "Phoenix", "id": "phoenix", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1213/"},
        {"name": "Denver", "id": "denver", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1276/"},
        {"name": "Portland", "id": "portland", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1338/"},
        {"name": "Orlando", "id": "orlando", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/"},
        {"name": "Memphis", "id": "memphis", "url": "https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1471/"}
    ]
    
    GROQ_API_KEY: str = os.environ.get("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    
    DATA_DIR: str = "data/laws"
    EXPORT_DIR: str = "data/export"
    REPORT_FILE: str = "data/report.json"
    
    REQUEST_DELAY: float = 2.0
    
    CODEX_KEYWORDS: Dict[str, List[str]] = {
        "UK": ["уголовный", "уголовный кодекс"],
        "AK": ["административный", "административный кодекс"],
        "PK": ["процессуальный", "процессуальный кодекс"],
        "DK": ["дорожный", "дорожный кодекс"]
    }


config = Config()
