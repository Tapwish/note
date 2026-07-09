import time
from typing import Any, Dict, List
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from utils.logger import logger
from parsers.article_parser import ArticleParser


class CodexParser:
    """Парсит кодекс через Selenium — извлекает текст и статьи"""
    
    def __init__(self, driver=None):
        self.driver = driver
        self.article_parser = ArticleParser()
    
    def parse_codex(self, url: str, driver=None) -> Dict[str, Any]:
        """
        Парсит кодекс по URL
        Возвращает {'url': str, 'articles': list}
        """
        logger.info("    📖 Парсинг статей...")
        
        if driver is None:
            driver = self.driver
        
        if not driver:
            logger.error("    ❌ Драйвер не передан")
            return {"url": url, "articles": []}
        
        try:
            # Загружаем страницу
            driver.get(url)
            time.sleep(2)
            
            # Ждем загрузки контента
            try:
                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR,
                        "div.message-content, div.bbWrapper, div.message-body, article.message"))
                )
            except:
                pass
            
            time.sleep(1)
            
            # Извлекаем текст разными способами
            content = None
            selectors = [
                "div.message-content",
                "div.bbWrapper",
                "div.message-body",
                "article.message",
                "div.post-content"
            ]
            
            for selector in selectors:
                try:
                    elements = driver.find_elements(By.CSS_SELECTOR, selector)
                    if elements:
                        # Берем самый большой элемент
                        max_elem = max(elements, key=lambda e: len(e.text))
                        if len(max_elem.text) > 200:
                            content = max_elem.text
                            logger.info(f"    ✅ Найдено через {selector}: {len(content)} символов")
                            break
                except:
                    pass
            
            # Если ничего не нашли — берем весь текст страницы
            if not content or len(content) < 100:
                content = driver.find_element(By.TAG_NAME, "body").text
                logger.info(f"    ⚠️ Взят весь текст: {len(content)} символов")
            
            if content and len(content) > 100:
                # Парсим статьи
                articles = self.article_parser.parse(content)
                logger.info(f"    📊 Найдено статей: {len(articles)}")
                return {"url": url, "articles": articles}
            else:
                logger.warning("    ⚠️ Текст не найден или слишком короткий")
                return {"url": url, "articles": []}
        
        except Exception as e:
            logger.error(f"    ❌ Ошибка парсинга: {str(e)}")
            return {"url": url, "articles": []}
