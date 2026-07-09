# parsers/codex_parser.py

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from utils.logger import logger
import re


class CodexParser:
    def __init__(self, driver):
        self.driver = driver
    
    def get_codex_content(self, url: str, driver) -> str:
        """
        Загружает страницу кодекса и извлекает HTML-контент
        """
        try:
            logger.info(f"  🌐 Загрузка: {url}")
            driver.get(url)
            
            # Ждём загрузки страницы
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.CLASS_NAME, "message-content"))
            )
            
            # Получаем HTML
            html = driver.page_source
            return html
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка загрузки: {str(e)}")
            return None
    
    def extract_text(self, html: str) -> str:
        """
        Извлекает чистый текст из HTML кодекса
        """
        try:
            from bs4 import BeautifulSoup
            
            soup = BeautifulSoup(html, 'html.parser')
            
            # Ищем контент сообщения
            content = soup.find('div', class_='message-content')
            if not content:
                content = soup.find('article', class_='message')
            if not content:
                content = soup.find('div', class_='bbWrapper')
            
            if not content:
                logger.error("  ❌ Не найден контейнер с текстом")
                return ""
            
            # Извлекаем текст
            text = content.get_text(separator='\n', strip=True)
            
            # Чистим от лишних пробелов
            text = re.sub(r'\n{3,}', '\n\n', text)
            text = re.sub(r'[ \t]+', ' ', text)
            
            # Убираем мусорные строки
            lines = text.split('\n')
            cleaned_lines = []
            for line in lines:
                line = line.strip()
                if line and not line.startswith('#'):
                    cleaned_lines.append(line)
            
            result = '\n'.join(cleaned_lines)
            logger.info(f"  ✅ Извлечено {len(result)} символов")
            return result
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка извлечения текста: {str(e)}")
            return ""
    
    def find_codex_links(self, section_url: str) -> dict:
        """
        Находит ссылки на кодексы в разделе
        (используется forum_parser, но метод может быть здесь)
        """
        # Этот метод перенесён в forum_parser.py
        # Оставлен для совместимости
        return {}