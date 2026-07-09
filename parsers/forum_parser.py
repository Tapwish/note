import time
from typing import Dict, Optional
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
from utils.logger import logger
from config import config


class ForumParser:
    """Парсер форума через Selenium — обходит Cloudflare"""
    
    def __init__(self, driver):
        self.driver = driver
    
    def fetch_page(self, url: str, wait_time: int = 8) -> Optional[str]:
        """Загружает страницу через Selenium с ожиданием"""
        try:
            logger.info(f"  🌐 Загрузка: {url}")
            self.driver.get(url)
            
            # Ждем загрузки контента
            try:
                WebDriverWait(self.driver, 20).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, 
                        "div.structItem, div.message, article.message, div.thread, a[href*='/threads/']"))
                )
            except:
                pass
            
            time.sleep(wait_time)
            
            # Проверяем, не Cloudflare ли это
            html = self.driver.page_source
            if "cf-browser-verification" in html or "Checking your browser" in html:
                logger.warning("  ⚠️ Cloudflare защита, ждем...")
                time.sleep(15)
                self.driver.refresh()
                time.sleep(10)
                html = self.driver.page_source
            
            return html
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка загрузки {url}: {str(e)}")
            return None
    
    def find_codexes_in_section(self, section_url: str) -> Dict[str, str]:
        """Находит все кодексы через Selenium"""
        logger.info("🔍 Поиск кодексов...")
        
        html = self.fetch_page(section_url, wait_time=8)
        if not html:
            logger.error("❌ Не удалось загрузить страницу")
            return {}
        
        soup = BeautifulSoup(html, 'lxml')
        found = {}
        
        # Ищем ссылки на темы
        for a in soup.find_all('a', href=True):
            title = a.get_text().strip()
            href = a.get('href', '')
            
            if not title or not href:
                continue
            if '/threads/' not in href:
                continue
            
            for codex_type, keywords in config.CODEX_KEYWORDS.items():
                for keyword in keywords:
                    if keyword.lower() in title.lower():
                        if not href.startswith('http'):
                            href = f"{config.FORUM_URL}{href}"
                        found[codex_type] = href
                        logger.success(f"  ✅ Найден {codex_type}: {title}")
                        break
        
        return found
    
    def fetch_codex_content(self, url: str) -> Optional[str]:
        """Загружает кодекс через Selenium"""
        return self.fetch_page(url, wait_time=5)
