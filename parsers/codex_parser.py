# parsers/codex_parser.py

import re
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from utils.logger import logger


class CodexParser:
    def __init__(self, driver):
        self.driver = driver
    
    def get_codex_content(self, url: str, driver) -> str:
        """
        Загружает страницу кодекса и возвращает HTML
        """
        try:
            logger.info(f"  🌐 Загрузка: {url}")
            driver.get(url)
            
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            # Прокручиваем для полной загрузки
            for _ in range(3):
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                import time
                time.sleep(1)
            
            driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(1)
            
            return driver.page_source
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка загрузки: {str(e)}")
            return None
    
    def extract_text(self, html: str) -> str:
        """
        Извлекает чистый текст из HTML
        Универсальный метод — работает с любой структурой
        """
        if not html:
            return ""
        
        try:
            from bs4 import BeautifulSoup
            
            soup = BeautifulSoup(html, 'html.parser')
            
            # ============================================================
            # 1. УДАЛЯЕМ НЕНУЖНЫЕ ЭЛЕМЕНТЫ
            # ============================================================
            
            for script in soup(["script", "style", "noscript", "nav", "header", "footer", "aside"]):
                script.decompose()
            
            # ============================================================
            # 2. ИЩЕМ КОНТЕНТ — 7 СПОСОБОВ
            # ============================================================
            
            content = None
            
            # Способ 1: Ищем ВСЕ сообщения (посты)
            messages = soup.find_all('article', class_=re.compile(r'message', re.I))
            
            if messages:
                best_message = None
                best_length = 0
                
                for msg in messages:
                    msg_content = msg.find('div', class_=re.compile(r'message-content|bbWrapper|message-body', re.I))
                    if not msg_content:
                        msg_content = msg
                    
                    text = msg_content.get_text(separator='\n', strip=True)
                    text_len = len(text)
                    
                    # Проверяем наличие ключевых слов кодекса
                    has_codex = ('кодекс' in text.lower() or 
                                'статья' in text.lower() or 
                                'наказание' in text.lower() or
                                'глава' in text.lower() or
                                'раздел' in text.lower())
                    
                    weight = text_len * (3 if has_codex else 1)
                    
                    if weight > best_length:
                        best_length = weight
                        best_message = msg_content
                
                if best_message:
                    content = best_message
            
            # Способ 2: message-content
            if not content:
                content = soup.find('div', class_=re.compile(r'message-content', re.I))
            
            # Способ 3: bbWrapper
            if not content:
                content = soup.find('div', class_=re.compile(r'bbWrapper', re.I))
            
            # Способ 4: любой div с большим текстом
            if not content:
                all_divs = soup.find_all('div')
                best_div = None
                best_length = 0
                
                for div in all_divs:
                    text = div.get_text(strip=True)
                    if len(text) < 500:
                        continue
                    
                    has_codex = ('кодекс' in text.lower() or 
                                'статья' in text.lower() or 
                                'наказание' in text.lower() or
                                'глава' in text.lower())
                    
                    weight = len(text) * (2 if has_codex else 1)
                    
                    if weight > best_length:
                        best_length = weight
                        best_div = div
                
                if best_div:
                    content = best_div
            
            # Способ 5: body
            if not content:
                content = soup.find('body')
            
            if not content:
                logger.error("  ❌ Не найден контейнер с текстом")
                return ""
            
            # ============================================================
            # 3. ИЗВЛЕКАЕМ ТЕКСТ
            # ============================================================
            
            text = content.get_text(separator='\n', strip=True)
            
            # Очищаем
            text = self._clean_text(text)
            
            # Проверяем, что это действительно кодекс
            if not self._is_codex_text(text):
                logger.warning("  ⚠️ Текст не похож на кодекс")
                # Пробуем альтернативный метод
                alt_text = self._find_alternative_content(soup)
                if alt_text and len(alt_text) > len(text):
                    text = alt_text
            
            logger.info(f"  ✅ Извлечено {len(text)} символов")
            return text
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка извлечения текста: {str(e)}")
            import traceback
            traceback.print_exc()
            return ""
    
    def _clean_text(self, text: str) -> str:
        """Очищает текст от мусора"""
        if not text:
            return ""
        
        # Убираем спецсимволы
        text = re.sub(r'[^\w\s\.\,\;\:\!\?\-\n\(\)\[\]\{\}\"\'\–\—]', ' ', text)
        
        # Нормализуем
        text = re.sub(r'\n{4,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        
        # Убираем пустые строки
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        text = '\n'.join(lines)
        
        return text
    
    def _is_codex_text(self, text: str) -> bool:
        """Проверяет, является ли текст кодексом"""
        codex_keywords = [
            'кодекс', 'статья', 'наказание', 'ч.', 'ст.',
            'уголовный', 'административный', 'процессуальный', 'дорожный',
            'преступление', 'правонарушение', 'штраф', 'лишение свободы',
            'глава', 'раздел', 'общая часть', 'особенная часть',
            'водитель', 'пешеход', 'обгон', 'парковка', 'перекресток'
        ]
        
        text_lower = text.lower()
        matches = sum(1 for keyword in codex_keywords if keyword in text_lower)
        
        return matches >= 3
    
    def _find_alternative_content(self, soup) -> str:
        """Пытается найти альтернативный контент"""
        try:
            combined_text = []
            
            for elem in soup.find_all(['p', 'div', 'article', 'section']):
                text = elem.get_text(strip=True)
                if len(text) > 200 and self._is_codex_text(text):
                    combined_text.append(text)
            
            if combined_text:
                result = '\n\n'.join(combined_text)
                logger.info(f"  ✅ Найдено альтернативное содержимое: {len(result)} символов")
                return result
            
            return ""
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка поиска альтернативного контента: {str(e)}")
            return ""
