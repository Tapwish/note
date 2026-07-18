# parsers/forum_parser.py

import re
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from utils.logger import logger
from config import config
from bs4 import BeautifulSoup


class ForumParser:
    def __init__(self, driver, ai_parser):
        self.driver = driver
        self.ai_parser = ai_parser  # 🔥 Передаем AI парсер для обработки HTML
    
    def find_codexes_in_section(self, section_url: str) -> dict:
        """
        Находит ссылки на кодексы в разделе
        Универсальный метод, работает с любой структурой
        """
        codex_links = {}
        
        try:
            logger.info(f"  🔍 Поиск кодексов...")
            logger.info(f"  🌐 Загрузка: {section_url}")
            
            self.driver.get(section_url)
            
            WebDriverWait(self.driver, 20).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            # ============================================================
            # 1. ПОИСК ПО ЗАГОЛОВКАМ СТАТЕЙ
            # ============================================================
            
            title_selectors = [
                ".structItem-title a",
                ".title a",
                ".thread-title a",
                "h3 a",
                ".node-title a",
                "a[data-thread-title]"
            ]
            
            for selector in title_selectors:
                try:
                    links = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    for link in links:
                        title = link.text.strip()
                        href = link.get_attribute('href')
                        if title and 'кодекс' in title.lower() and href:
                            self._add_codex_link(codex_links, title, href)
                except:
                    continue
            
            # ============================================================
            # 2. ПОИСК ПО ВСЕМ ССЫЛКАМ НА СТРАНИЦЕ
            # ============================================================
            
            if not codex_links:
                all_links = self.driver.find_elements(By.TAG_NAME, "a")
                for link in all_links:
                    try:
                        title = link.text.strip()
                        href = link.get_attribute('href')
                        if title and 'кодекс' in title.lower() and href:
                            self._add_codex_link(codex_links, title, href)
                    except:
                        continue
            
            # ============================================================
            # 3. ПОИСК В СТРУКТУРЕ ДЕРЕВА
            # ============================================================
            
            if not codex_links:
                elements = self.driver.find_elements(By.XPATH, "//*[contains(@class, 'thread') or contains(@class, 'node')]")
                for elem in elements:
                    try:
                        text = elem.text.strip()
                        if 'кодекс' in text.lower():
                            link = elem.find_element(By.TAG_NAME, "a")
                            if link:
                                href = link.get_attribute('href')
                                title = link.text.strip()
                                if href:
                                    self._add_codex_link(codex_links, title or text, href)
                    except:
                        continue
            
            # ============================================================
            # 4. ПОИСК ПО КОНТЕНТУ
            # ============================================================
            
            if not codex_links:
                html = self.driver.page_source
                soup = BeautifulSoup(html, 'html.parser')
                
                for a in soup.find_all('a', href=True):
                    text = a.get_text(strip=True)
                    href = a.get('href')
                    if text and 'кодекс' in text.lower() and href:
                        if href.startswith('/'):
                            href = f"https://forum.majestic-rp.ru{href}"
                        self._add_codex_link(codex_links, text, href)
            
            if not codex_links:
                logger.warning(f"  ⚠️ Кодексы не найдены в {section_url}")
            else:
                logger.info(f"  ✅ Найдено {len(codex_links)} кодексов")
            
            return codex_links
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка поиска кодексов: {str(e)}")
            return {}
    
    def _add_codex_link(self, codex_links: dict, title: str, href: str):
        """Добавляет ссылку на кодекс в словарь"""
        title_lower = title.lower()
        
        for codex_type, keywords in config.CODEX_KEYWORDS.items():
            for keyword in keywords:
                if keyword in title_lower:
                    if codex_type not in codex_links:
                        codex_links[codex_type] = href
                        logger.info(f"    ✅ Найден {codex_type}: {title[:50]}...")
                    return
        
        # Если не определился тип, пробуем по ключевым словам
        if 'уголовный' in title_lower:
            codex_links['UK'] = href
            logger.info(f"    ✅ Найден UK: {title[:50]}...")
        elif 'административный' in title_lower:
            codex_links['AK'] = href
            logger.info(f"    ✅ Найден AK: {title[:50]}...")
        elif 'процессуальный' in title_lower:
            codex_links['PK'] = href
            logger.info(f"    ✅ Найден PK: {title[:50]}...")
        elif 'дорожный' in title_lower:
            codex_links['DK'] = href
            logger.info(f"    ✅ Найден DK: {title[:50]}...")
    
    # ================================================================
    # 🔥 НОВЫЙ МЕТОД: ИЗВЛЕКАЕТ HTML И ПЕРЕДАЕТ В AI
    # ================================================================
    
    def parse_codex_page(self, codex_url: str, codex_type: str) -> dict:
        """
        Загружает страницу кодекса, извлекает HTML и отправляет в AI для структурирования
        
        Args:
            codex_url: URL страницы кодекса
            codex_type: Тип кодекса (UK, AK, PK, DK)
        
        Returns:
            Структурированный JSON от AI
        """
        logger.info(f"  📄 Загрузка страницы {codex_type}: {codex_url}")
        
        try:
            # Загружаем страницу
            self.driver.get(codex_url)
            
            WebDriverWait(self.driver, 30).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            # Прокручиваем для загрузки всего контента
            for _ in range(3):
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                import time
                time.sleep(1)
            
            # Получаем HTML
            html = self.driver.page_source
            
            # 🔥 ПЕРЕДАЕМ HTML В AI ДЛЯ СТРУКТУРИРОВАНИЯ
            result = self.ai_parser.parse_html_to_json(html, codex_type)
            
            return result
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка загрузки {codex_type}: {str(e)}")
            return {"sections": [], "error": str(e)}
