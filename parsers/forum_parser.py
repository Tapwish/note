import time
from typing import List, Dict, Optional
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
from utils.logger import logger
from config import config


class ForumParser:
    """Парсер форума с Edge для обхода Cloudflare"""
    
    def __init__(self, driver):
        """Инициализирует парсер с Edge WebDriver"""
        self.driver = driver
    
    def fetch_page(self, url: str, wait_time: int = 5) -> Optional[str]:
        """
        Загружает страницу через Edge с ожиданием загрузки
        """
        try:
            logger.info(f"  🌐 Загрузка: {url}")
            self.driver.get(url)
            
            # Ждем, пока страница загрузится
            time.sleep(wait_time)
            
            # Ждем появления контента
            try:
                WebDriverWait(self.driver, 20).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "div.structItem, div.message, article.message"))
                )
            except:
                pass
            
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
        """
        Находит все кодексы в разделе законодательной базы
        Ищет по точным названиям: "Уголовный кодекс", "Административный кодекс" и т.д.
        """
        logger.info("🔍 Поиск кодексов по точным названиям...")
        
        html = self.fetch_page(section_url, wait_time=8)
        if not html:
            logger.error("❌ Не удалось загрузить страницу")
            return {}
        
        soup = BeautifulSoup(html, 'lxml')
        found_codexes = {}
        
        # === Ищем все темы ===
        threads = self._find_all_threads(soup)
        logger.debug(f"Найдено {len(threads)} тем")
        
        # Показываем все темы для отладки
        if threads:
            titles = [t.get('title', '') for t in threads[:10]]
            logger.info(f"  📋 Найденные темы: {', '.join(titles)}")
        
        for thread in threads:
            title = thread.get('title', '')
            link = thread.get('link', '')
            
            if not title or not link:
                continue
            
            # Проверяем точное совпадение с названиями кодексов
            codex_type = self._match_exact_title(title)
            if codex_type:
                found_codexes[codex_type] = link
                logger.success(f"  ✅ Найден {codex_type}: {title}")
        
        # === Если не нашли, ищем по всем ссылкам ===
        if not found_codexes:
            logger.debug("Поиск по всем ссылкам на странице...")
            all_links = soup.find_all('a', href=True)
            
            for a in all_links:
                title = a.get_text().strip()
                href = a.get('href', '')
                
                if not title or not href:
                    continue
                
                if '/threads/' not in href:
                    continue
                
                codex_type = self._match_exact_title(title)
                if codex_type:
                    if not href.startswith('http'):
                        href = f"{config.FORUM_URL}{href}"
                    found_codexes[codex_type] = href
                    logger.success(f"  ✅ Найден {codex_type}: {title}")
        
        # Проверяем результат
        expected = set(config.CODEX_TITLES.keys())
        found = set(found_codexes.keys())
        missing = expected - found
        
        if missing:
            logger.warning(f"  ⚠️ Не найдены кодексы: {', '.join(missing)}")
        else:
            logger.success(f"✅ Найдены все кодексы: {', '.join(found)}")
        
        return found_codexes
    
    def _find_all_threads(self, soup: BeautifulSoup) -> List[Dict[str, str]]:
        """Находит все темы на странице"""
        threads = []
        
        # Способ 1: structItem (XenForo 2)
        for item in soup.find_all('div', class_='structItem'):
            title_elem = item.find('a', class_='structItem-title')
            if title_elem:
                title = title_elem.get_text().strip()
                link = title_elem.get('href', '')
                if title and link:
                    if not link.startswith('http'):
                        link = f"{config.FORUM_URL}{link}"
                    threads.append({'title': title, 'link': link})
        
        # Способ 2: li.thread
        if not threads:
            for item in soup.find_all('li', class_='thread'):
                title_elem = item.find('a', class_='title')
                if not title_elem:
                    title_elem = item.find('a')
                if title_elem:
                    title = title_elem.get_text().strip()
                    link = title_elem.get('href', '')
                    if title and link:
                        if not link.startswith('http'):
                            link = f"{config.FORUM_URL}{link}"
                        threads.append({'title': title, 'link': link})
        
        # Способ 3: Все ссылки с /threads/
        if not threads:
            for a in soup.find_all('a', href=True):
                href = a.get('href', '')
                if '/threads/' in href:
                    title = a.get_text().strip()
                    if title and len(title) > 5:
                        if not href.startswith('http'):
                            href = f"{config.FORUM_URL}{href}"
                        threads.append({'title': title, 'link': href})
        
        # Удаляем дубликаты
        seen = set()
        unique_threads = []
        for t in threads:
            key = t['link']
            if key not in seen:
                seen.add(key)
                unique_threads.append(t)
        
        return unique_threads
    
    def _match_exact_title(self, title: str) -> Optional[str]:
        """Проверяет точное совпадение с названиями кодексов"""
        title_clean = title.strip()
        
        for codex_type, titles in config.CODEX_TITLES.items():
            for exact_title in titles:
                if exact_title.lower() in title_clean.lower():
                    return codex_type
        
        return None
    
    def fetch_codex_content(self, url: str) -> Optional[str]:
        """Загрузка содержимого кодекса по ссылке (устаревший метод)"""
        return self.fetch_page(url, wait_time=5)