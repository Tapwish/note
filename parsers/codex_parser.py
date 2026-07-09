"""Загрузка и парсинг отдельного кодекса через Edge."""

import time
from typing import Any
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from utils.logger import logger
from parsers.article_parser import ArticleParser


class CodexParser:
    """Парсит одну тему кодекса через Edge."""

    def __init__(self, driver=None):
        """Инициализирует парсер."""
        self.driver = driver
        self.article_parser = ArticleParser()

    def parse_codex(self, url: str, driver=None) -> dict[str, Any]:
        """
        Парсинг кодекса через Edge.
        
        Args:
            url: URL кодекса
            driver: Edge WebDriver
            
        Returns:
            Словарь {'url': str, 'articles': list}
        """
        logger.info("    📖 Парсинг статей через Edge...")
        
        if driver is None:
            driver = self.driver
            
        if not driver:
            logger.error("    ❌ Edge driver не передан")
            return {"url": url, "articles": []}
        
        try:
            # Загружаем страницу
            driver.get(url)
            time.sleep(3)
            
            # Ждем загрузки контента
            try:
                WebDriverWait(driver, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, 
                        "div.message-content, div.bbWrapper, div.message-body, article.message"))
                )
            except:
                pass
            
            # Даем время на полную загрузку
            time.sleep(2)
            
            # Пробуем найти контент разными способами
            content = None
            
            # Способ 1: message-content
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, "div.message-content")
                if elements:
                    max_elem = max(elements, key=lambda e: len(e.text))
                    if len(max_elem.text) > 200:
                        content = max_elem.text
                        logger.info(f"    ✅ Найдено через message-content: {len(content)} символов")
            except:
                pass
            
            # Способ 2: bbWrapper
            if not content or len(content) < 200:
                try:
                    elements = driver.find_elements(By.CSS_SELECTOR, "div.bbWrapper")
                    if elements:
                        max_elem = max(elements, key=lambda e: len(e.text))
                        if len(max_elem.text) > 200:
                            content = max_elem.text
                            logger.info(f"    ✅ Найдено через bbWrapper: {len(content)} символов")
                except:
                    pass
            
            # Способ 3: message-body
            if not content or len(content) < 200:
                try:
                    elements = driver.find_elements(By.CSS_SELECTOR, "div.message-body")
                    if elements:
                        max_elem = max(elements, key=lambda e: len(e.text))
                        if len(max_elem.text) > 200:
                            content = max_elem.text
                            logger.info(f"    ✅ Найдено через message-body: {len(content)} символов")
                except:
                    pass
            
            # Способ 4: article.message
            if not content or len(content) < 200:
                try:
                    elements = driver.find_elements(By.CSS_SELECTOR, "article.message")
                    if elements:
                        max_elem = max(elements, key=lambda e: len(e.text))
                        if len(max_elem.text) > 200:
                            content = max_elem.text
                            logger.info(f"    ✅ Найдено через article.message: {len(content)} символов")
                except:
                    pass
            
            # Способ 5: Весь текст страницы
            if not content or len(content) < 100:
                try:
                    content = driver.find_element(By.TAG_NAME, "body").text
                    logger.info(f"    ⚠️ Взят весь текст страницы: {len(content)} символов")
                except:
                    pass
            
            if content and len(content) > 100:
                logger.info(f"    📄 Найдено {len(content)} символов текста")
                
                # Парсим статьи
                articles = self.article_parser.parse(content)
                logger.info(f"    📊 Найдено статей: {len(articles)}")
                
                return {"url": url, "articles": articles}
            else:
                logger.warning(f"    ⚠️ Не удалось извлечь текст")
                return {"url": url, "articles": []}
                
        except Exception as e:
            logger.error(f"    ❌ Ошибка парсинга: {str(e)}")
            return {"url": url, "articles": []}