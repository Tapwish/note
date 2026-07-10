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
            
            # Ждём загрузки страницы
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            # Прокручиваем страницу для полной загрузки
            for _ in range(3):
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                import time
                time.sleep(1)
            
            # Возвращаемся в начало
            driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(1)
            
            return driver.page_source
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка загрузки: {str(e)}")
            return None
    
    def extract_text(self, html: str) -> str:
        """
        Извлекает чистый текст из HTML кодекса
        Универсальный метод, работает с любой структурой
        """
        if not html:
            return ""
        
        try:
            from bs4 import BeautifulSoup
            
            soup = BeautifulSoup(html, 'html.parser')
            
            # ============================================================
            # 1. УДАЛЯЕМ НЕНУЖНЫЕ ЭЛЕМЕНТЫ
            # ============================================================
            
            # Удаляем скрипты и стили
            for script in soup(["script", "style", "noscript"]):
                script.decompose()
            
            # Удаляем навигацию и шапку
            for nav in soup.find_all(['nav', 'header', 'footer', 'aside']):
                nav.decompose()
            
            # Удаляем элементы с классами, содержащими навигацию
            for element in soup.find_all(class_=re.compile(r'(nav|menu|header|footer|sidebar|breadcrumb|pagination|reactions|share)', re.I)):
                element.decompose()
            
            # Удаляем элементы с атрибутами роли навигации
            for element in soup.find_all(role=re.compile(r'(nav|menu|banner|complementary)', re.I)):
                element.decompose()
            
            # ============================================================
            # 2. ИЩЕМ ОСНОВНОЙ КОНТЕНТ (ПО ПРИОРИТЕТУ)
            # ============================================================
            
            content = None
            
            # ПРИОРИТЕТ 1: Ищем все сообщения (посты) на странице
            messages = soup.find_all('article', class_=re.compile(r'message', re.I))
            
            if messages:
                best_message = None
                best_length = 0
                
                for msg in messages:
                    msg_content = msg.find('div', class_=re.compile(r'message-content|bbWrapper|message-body', re.I))
                    if not msg_content:
                        msg_content = msg
                    
                    text = msg_content.get_text(strip=True)
                    text_len = len(text)
                    
                    has_codex = ('кодекс' in text.lower() or 
                                'статья' in text.lower() or 
                                'наказание' in text.lower() or
                                'ч.' in text.lower())
                    
                    weight = text_len * (2 if has_codex else 1)
                    
                    if weight > best_length:
                        best_length = weight
                        best_message = msg_content if msg_content else msg
                
                if best_message:
                    content = best_message
            
            # ПРИОРИТЕТ 2: Ищем message-content напрямую
            if not content:
                content = soup.find('div', class_=re.compile(r'message-content', re.I))
            
            # ПРИОРИТЕТ 3: Ищем bbWrapper
            if not content:
                content = soup.find('div', class_=re.compile(r'bbWrapper', re.I))
            
            # ПРИОРИТЕТ 4: Ищем любой div с большим количеством текста
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
                                'наказание' in text.lower())
                    
                    weight = len(text) * (2 if has_codex else 1)
                    
                    if weight > best_length:
                        best_length = weight
                        best_div = div
                
                if best_div:
                    content = best_div
            
            # ПРИОРИТЕТ 5: Ищем div с классом, содержащим "content" или "body"
            if not content:
                for class_name in ['content', 'body', 'post', 'entry', 'article']:
                    elem = soup.find('div', class_=re.compile(class_name, re.I))
                    if elem and len(elem.get_text(strip=True)) > 1000:
                        content = elem
                        break
            
            # ПРИОРИТЕТ 6: Ищем основной div на странице
            if not content:
                body = soup.find('body')
                if body:
                    for child in body.find_all(recursive=False):
                        if child.name == 'div' and len(child.get_text(strip=True)) > 500:
                            content = child
                            break
            
            if not content:
                logger.error("  ❌ Не найден контейнер с текстом")
                return ""
            
            # ============================================================
            # 3. ИЗВЛЕКАЕМ И ОЧИЩАЕМ ТЕКСТ
            # ============================================================
            
            text = content.get_text(separator='\n', strip=True)
            text = self._clean_text(text)
            
            if not self._is_codex_text(text):
                logger.warning("  ⚠️ Извлечённый текст не содержит признаков кодекса")
                return self._find_alternative_content(soup)
            
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
        
        text = re.sub(r'[^\w\s\.\,\;\:\!\?\-\n\(\)\[\]\{\}\"\'\–\—]', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        text = '\n'.join(lines)
        
        return text
    
    def _is_codex_text(self, text: str) -> bool:
        """Проверяет, является ли текст кодексом"""
        codex_keywords = [
            'кодекс', 'статья', 'наказание', 'ч.', 'ст.',
            'уголовный', 'административный', 'процессуальный', 'дорожный',
            'преступление', 'правонарушение', 'штраф', 'лишение свободы'
        ]
        
        text_lower = text.lower()
        matches = sum(1 for keyword in codex_keywords if keyword in text_lower)
        
        return matches >= 3
    
    def _find_alternative_content(self, soup) -> str:
        """Пытается найти альтернативный контент"""
        try:
            all_elements = soup.find_all(['p', 'div', 'article', 'section'])
            
            combined_text = []
            for elem in all_elements:
                text = elem.get_text(strip=True)
                if self._is_codex_text(text) and len(text) > 200:
                    combined_text.append(text)
            
            if combined_text:
                result = '\n\n'.join(combined_text)
                logger.info(f"  ✅ Найдено альтернативное содержимое: {len(result)} символов")
                return result
            
            body = soup.find('body')
            if body:
                text = body.get_text(separator='\n', strip=True)
                text = self._clean_text(text)
                logger.info(f"  ⚠️ Использован весь текст body: {len(text)} символов")
                return text
            
            return ""
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка поиска альтернативного контента: {str(e)}")
            return ""
