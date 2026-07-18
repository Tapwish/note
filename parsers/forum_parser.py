# parsers/forum_parser.py

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from utils.logger import logger


class ForumParser:
    """Парсер для поиска ссылок на кодексы в разделе форума"""
    
    def __init__(self, driver):
        self.driver = driver
    
    def find_codexes_in_section(self, section_url: str) -> dict:
        """
        Находит ссылки на кодексы (УК, АК, ПК, ДК) в разделе
        
        Returns:
            dict: {"UK": "url", "AK": "url", ...}
        """
        codex_links = {}
        
        try:
            logger.info(f"  🔍 Поиск кодексов...")
            self.driver.get(section_url)
            
            WebDriverWait(self.driver, 20).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            # Селекторы для поиска ссылок
            selectors = [
                ".structItem-title a",
                ".title a",
                ".thread-title a",
                "h3 a",
                ".node-title a",
                "a[data-thread-title]"
            ]
            
            for selector in selectors:
                try:
                    links = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    for link in links:
                        title = link.text.strip()
                        href = link.get_attribute('href')
                        if title and href and self._is_codex(title):
                            self._add_codex_link(codex_links, title, href)
                except:
                    continue
            
            # Если не нашли - ищем все ссылки
            if not codex_links:
                all_links = self.driver.find_elements(By.TAG_NAME, "a")
                for link in all_links:
                    title = link.text.strip()
                    href = link.get_attribute('href')
                    if title and href and self._is_codex(title):
                        self._add_codex_link(codex_links, title, href)
            
            if codex_links:
                logger.info(f"  ✅ Найдено {len(codex_links)} кодексов")
                for codex_type, url in codex_links.items():
                    logger.info(f"    📄 {codex_type}: {url}")
            else:
                logger.warning("  ⚠️ Кодексы не найдены")
            
            return codex_links
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка: {str(e)}")
            return {}
    
    def _is_codex(self, title: str) -> bool:
        """Проверяет, похоже ли название на кодекс"""
        keywords = [
            'кодекс', 'уголовный', 'административный',
            'процессуальный', 'дорожный', 'ук', 'ак', 'пк', 'дк'
        ]
        return any(kw in title.lower() for kw in keywords)
    
    def _add_codex_link(self, codex_links: dict, title: str, href: str):
        """Добавляет ссылку на кодекс с определением типа"""
        title_lower = title.lower()
        
        codex_map = {
            'UK': ['уголовный', 'ук'],
            'AK': ['административный', 'ак'],
            'PK': ['процессуальный', 'пк'],
            'DK': ['дорожный', 'дк']
        }
        
        for codex_type, keywords in codex_map.items():
            if any(kw in title_lower for kw in keywords):
                if codex_type not in codex_links:
                    codex_links[codex_type] = href
                    logger.info(f"    ✅ Найден {codex_type}")
                return