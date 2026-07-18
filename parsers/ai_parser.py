# parsers/ai_parser.py

import json
import re
import time
from typing import Dict, Any, Optional
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from utils.logger import logger

# 🔥 Groq SDK
from groq import Groq


class AIParser:
    """Парсер с использованием Groq AI (бесплатно, ~1000 запросов/день)"""

    def __init__(self, driver, api_key: str, model: str = "llama-3.3-70b-versatile"):
        self.driver = driver
        self.api_key = api_key
        self.model = model
        
        # Инициализируем клиент Groq
        self.client = Groq(api_key=self.api_key)
        logger.info(f"🤖 Инициализирован Groq AI с моделью: {self.model}")

    def parse_codex(self, url: str, codex_type: str = "UK") -> Dict[str, Any]:
        """
        Парсит кодекс через Groq AI
        
        Args:
            url: URL страницы с кодексом
            codex_type: Тип кодекса (UK, AK, PK, DK)
        
        Returns:
            Dict с данными кодекса в формате для приложения
        """
        logger.info(f"  🤖 AI парсинг {codex_type}...")
        
        try:
            # Загружаем страницу
            self.driver.get(url)
            WebDriverWait(self.driver, 30).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            # Прокручиваем для загрузки
            for _ in range(3):
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(1)
            
            html = self.driver.page_source
            
            # Очищаем HTML
            clean_html = self._clean_html(html)
            
            # Формируем запрос к AI
            result = self._call_ai(clean_html, codex_type)
            
            if result:
                return result
            
            return {"sections": [], "error": "AI parsing failed"}
            
        except Exception as e:
            logger.error(f"  ❌ Ошибка AI: {str(e)}")
            return {"sections": [], "error": str(e)}
    
    def _clean_html(self, html: str) -> str:
        """Очищает HTML от мусора"""
        # Удаляем скрипты и стили
        html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
        html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
        
        # Удаляем теги, оставляем текст
        html = re.sub(r'<[^>]+>', ' ', html)
        
        # Схлопываем пробелы
        html = re.sub(r'\s+', ' ', html).strip()
        
        # Ограничиваем длину
        if len(html) > 30000:
            html = html[:30000]
        
        return html
    
    def _call_ai(self, text: str, codex_type: str) -> Optional[Dict]:
        """Вызывает Groq API для парсинга"""
        
        codex_names = {
            "UK": "Уголовный кодекс",
            "AK": "Административный кодекс",
            "PK": "Процессуальный кодекс",
            "DK": "Дорожный кодекс"
        }
        
        codex_name = codex_names.get(codex_type, "Кодекс")
        
        prompt = f"""
        Ты - AI-парсер законодательных текстов. Извлеки структурированные данные из текста {codex_name}.

        ВЕРНИ ТОЛЬКО JSON БЕЗ ЛИШНЕГО ТЕКСТА.

        Формат JSON для приложения:
        {{
            "name": "{codex_name} штата San-Andreas",
            "sections": [
                {{
                    "number": "I",
                    "title": "Название раздела",
                    "chapters": [
                        {{
                            "number": "I",
                            "title": "Название главы",
                            "articles": [
                                {{
                                    "id": "1",
                                    "title": "Название статьи",
                                    "parts": [
                                        {{"id": "ч.1", "text": "Текст части"}}
                                    ]
                                }}
                            ]
                        }}
                    ]
                }}
            ]
        }}

        ПРАВИЛА:
        1. Сохраняй структуру: sections → chapters → articles → parts
        2. Каждая статья должна иметь id, title, parts
        3. Если нет частей - parts: []
        4. Группируй статьи по разделам и главам
        5. Сохраняй полный текст без пропусков

        Текст для парсинга:
        {text[:20000]}

        ВЕРНИ ТОЛЬКО JSON.
        """
        
        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Ты - экспертный парсер законодательных текстов. Возвращай только валидный JSON."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                model=self.model,
                temperature=0.1,
                max_tokens=8000,
            )

            content = chat_completion.choices[0].message.content

            # Извлекаем JSON
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                # Проверяем структуру
                if "sections" not in result:
                    # Если AI не создал sections, оборачиваем
                    if "articles" in result:
                        result = {
                            "name": codex_names.get(codex_type, "Кодекс"),
                            "sections": [
                                {
                                    "number": "I",
                                    "title": codex_names.get(codex_type, "Кодекс"),
                                    "chapters": [
                                        {
                                            "number": "1",
                                            "title": "Статьи",
                                            "articles": result.get("articles", [])
                                        }
                                    ]
                                }
                            ]
                        }
                logger.info(f"  ✅ AI распарсил {len(result.get('sections', []))} разделов")
                return result
            else:
                logger.warning("  ⚠️ AI не вернул JSON")
                return None

        except Exception as e:
            logger.error(f"  ❌ Ошибка Groq API: {str(e)}")
            return None