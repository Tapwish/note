import cloudscraper
from typing import Dict, Optional
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential
from utils.logger import logger
from config import config


class ForumParser:
    """Парсер форума — находит кодексы по ключевым словам"""
    
    def __init__(self, driver):
        self.driver = driver
        self.session = cloudscraper.create_scraper(
            browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
        )
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    @retry(stop=stop_after_attempt(config.MAX_RETRIES), wait=wait_exponential(multiplier=1, min=1, max=16))
    def fetch_page(self, url: str) -> Optional[str]:
        """Загружает страницу через cloudscraper с повторными попытками"""
        try:
            response = self.session.get(url, timeout=(config.CONNECT_TIMEOUT, config.READ_TIMEOUT))
            if response.status_code == 200:
                return response.text
            logger.warning(f"HTTP {response.status_code} при загрузке {url}")
            return None
        except Exception as e:
            logger.error(f"Ошибка загрузки {url}: {str(e)}")
            raise
    
    def find_codexes_in_section(self, section_url: str) -> Dict[str, str]:
        """
        Находит все кодексы в разделе законодательной базы
        Возвращает {UK: ссылка, AK: ссылка, ...}
        """
        logger.info("🔍 Поиск кодексов...")
        
        html = self.fetch_page(section_url)
        if not html:
            logger.error("❌ Не удалось загрузить страницу")
            return {}
        
        soup = BeautifulSoup(html, 'lxml')
        found = {}
        
        # Ищем все ссылки на темы
        for a in soup.find_all('a', href=True):
            title = a.get_text().strip()
            href = a.get('href', '')
            
            if not title or not href:
                continue
            if '/threads/' not in href:
                continue
            
            # Проверяем ключевые слова
            for codex_type, keywords in config.CODEX_KEYWORDS.items():
                for keyword in keywords:
                    if keyword.lower() in title.lower():
                        if not href.startswith('http'):
                            href = f"{config.FORUM_URL}{href}"
                        found[codex_type] = href
                        logger.success(f"  ✅ Найден {codex_type}: {title}")
                        break
        
        # Проверяем, все ли кодексы найдены
        expected = set(config.CODEX_KEYWORDS.keys())
        missing = expected - set(found.keys())
        if missing:
            logger.warning(f"  ⚠️ Не найдены: {', '.join(missing)}")
        
        return found
    
    def fetch_codex_content(self, url: str) -> Optional[str]:
        """Загружает HTML кодекса"""
        html = self.fetch_page(url)
        if not html:
            return None
        
        soup = BeautifulSoup(html, 'lxml')
        
        # Ищем контент
        content = soup.find('div', class_='message-content')
        if not content:
            content = soup.find('div', class_='bbWrapper')
        if not content:
            content = soup.find('div', class_='message-body')
        if not content:
            content = soup.find('article', class_='message')
        
        if content:
            return str(content)
        
        return html
