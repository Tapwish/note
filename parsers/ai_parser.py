# parsers/ai_parser.py

import json
import re
from typing import Dict, Any, Optional
from utils.logger import logger
import requests


class AIParser:
    """AI парсер, который принимает HTML и структурирует его в JSON"""

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        self.api_key = api_key
        self.model = model
        self.api_url = "https://api.groq.com/openai/v1/chat/completions"
        
        logger.info(f"🤖 Инициализирован Groq AI с моделью: {self.model}")

    def parse_html_to_json(self, html: str, codex_type: str = "UK") -> Dict[str, Any]:
        """
        Принимает HTML-код страницы, отправляет в Groq AI для структурирования в JSON
        
        Args:
            html: HTML-код страницы кодекса
            codex_type: Тип кодекса (UK, AK, PK, DK)
        
        Returns:
            Структурированный JSON с данными кодекса
        """
        logger.info(f"  🤖 Отправка HTML в AI для структурирования...")
        
        if not html or len(html) < 1000:
            logger.error("  ❌ HTML слишком короткий или пустой")
            return {"sections": [], "error": "HTML too short"}
        
        # Ограничиваем длину HTML для AI
        if len(html) > 50000:
            html = html[:50000]
            logger.info(f"  📄 HTML обрезан до 50000 символов")
        
        # Подготавливаем промпт для AI
        prompt = self._build_prompt(html, codex_type)
        
        # Отправляем запрос к Groq
        result = self._call_groq(prompt)
        
        if result:
            logger.info(f"  ✅ AI успешно структурировал данные")
            return result
        else:
            logger.error("  ❌ AI не смог структурировать данные")
            return {"sections": [], "error": "AI parsing failed"}
    
    def _build_prompt(self, html: str, codex_type: str) -> str:
        """Создает промпт для AI на основе HTML"""
        
        codex_names = {
            "UK": "Уголовный кодекс",
            "AK": "Административный кодекс",
            "PK": "Процессуальный кодекс",
            "DK": "Дорожный кодекс"
        }
        
        codex_name = codex_names.get(codex_type, "Кодекс")
        
        prompt = f"""
        Ты - AI-парсер законодательных текстов. Проанализируй HTML-код страницы с {codex_name} и преобразуй его в структурированный JSON.

        ВЕРНИ ТОЛЬКО JSON БЕЗ ЛИШНЕГО ТЕКСТА.

        HTML-код страницы:
        {html}

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
        1. Найди в HTML все статьи кодекса
        2. Определи структуру: разделы → главы → статьи → части
        3. Каждая статья должна иметь id, title, parts
        4. Если нет частей - parts: []
        5. Группируй статьи по разделам и главам
        6. Сохраняй полный текст без пропусков
        7. Удали из текста всю лишнюю информацию (подписи, кнопки, навигацию)
        8. Нумеруй разделы и главы римскими цифрами (I, II, III...)
        9. Нумеруй статьи арабскими цифрами (1, 2, 3...)

        ВЕРНИ ТОЛЬКО JSON.
        """
        
        return prompt
    
    def _call_groq(self, prompt: str) -> Optional[Dict]:
        """Отправляет запрос к Groq API"""
        
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "Ты - экспертный парсер законодательных текстов. Возвращай только валидный JSON."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 8000
            }
            
            response = requests.post(
                self.api_url,
                headers=headers,
                json=payload,
                timeout=120
            )
            
            if response.status_code == 200:
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                # Извлекаем JSON
                json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                    return result
                else:
                    logger.warning("  ⚠️ AI не вернул JSON")
                    return None
            else:
                logger.error(f"  ❌ API ошибка {response.status_code}: {response.text}")
                return None

        except requests.exceptions.Timeout:
            logger.error("  ❌ Таймаут API")
            return None
        except Exception as e:
            logger.error(f"  ❌ Ошибка Groq API: {str(e)}")
            return None
