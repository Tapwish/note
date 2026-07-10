# parsers/article_parser.py

import re
import json
from typing import Any, Optional, List, Dict, Tuple


class ArticleParser:
    """
    Парсит текст кодекса в структурированные статьи
    """
    
    @staticmethod
    def parse(text: str, codex_type: str = 'uk') -> Dict[str, Any]:
        """
        Парсит текст кодекса в структурированный JSON
        """
        if not text or len(text.strip()) < 50:
            return {"theory": "", "articles": []}
        
        # 1. ИЗВЛЕКАЕМ ТЕОРИЮ
        theory, remaining = ArticleParser._extract_theory(text)
        
        # 2. РАЗБИВАЕМ НА БЛОКИ СТАТЕЙ
        blocks = ArticleParser._split_articles(remaining)
        
        # 3. ПАРСИМ КАЖДЫЙ БЛОК
        all_articles = []
        for block in blocks:
            parsed = ArticleParser._parse_article_block(block)
            if parsed:
                all_articles.extend(parsed)
        
        # 4. ОБЪЕДИНЯЕМ ДУБЛИРУЮЩИЕСЯ СТАТЬИ ПО КОДУ
        all_articles = ArticleParser._merge_duplicate_articles(all_articles)
        
        # 5. ДОБАВЛЯЕМ ID
        for i, article in enumerate(all_articles):
            if 'id' not in article:
                article['id'] = f"{codex_type}-{i+1}"
        
        return {
            "theory": theory,
            "articles": all_articles
        }
    
    # ================================================================
    # 1. ИЗВЛЕЧЕНИЕ ТЕОРИИ
    # ================================================================
    
    @staticmethod
    def _extract_theory(text: str) -> Tuple[str, str]:
        """Извлекает теорию до первой статьи с наказанием"""
        lines = text.split('\n')
        theory_lines = []
        remaining_lines = []
        found_penalty_article = False
        
        for i, line in enumerate(lines):
            stripped = line.strip()
            
            # Проверяем начало статьи
            if re.match(r"^(?:Статья|Ст\.?)\s*№?\s*[\d\.]+", stripped, re.IGNORECASE):
                # Проверяем следующие 10 строк на наличие наказания
                check_lines = lines[i:min(i+10, len(lines))]
                check_text = '\n'.join(check_lines)
                
                has_penalty = ArticleParser._has_penalty(check_text)
                
                if has_penalty:
                    found_penalty_article = True
                    remaining_lines = lines[i:]
                    break
                else:
                    theory_lines.append(line)
                    continue
            
            if not found_penalty_article:
                theory_lines.append(line)
            else:
                remaining_lines.append(line)
        
        if not found_penalty_article:
            return '\n'.join(lines), ''
        
        theory = '\n'.join(theory_lines).strip()
        remaining = '\n'.join(remaining_lines).strip()
        
        return theory, remaining
    
    @staticmethod
    def _has_penalty(text: str) -> bool:
        """Проверяет, есть ли в тексте наказание"""
        return bool(re.search(r'(?:Наказание|Штраф|Санкция|Ответственность)', text, re.IGNORECASE))
    
    # ================================================================
    # 2. РАЗБИВКА НА БЛОКИ СТАТЕЙ
    # ================================================================
    
    @staticmethod
    def _split_articles(text: str) -> List[str]:
        """Разбивает текст на блоки статей"""
        lines = text.split("\n")
        blocks = []
        current = []
        
        skip_patterns = [
            r"^РАЗДЕЛ\s+[IVXLCDM]+",
            r"^Раздел\s+[IVXLCDM]+",
            r"^ГЛАВА\s+[IVXLCDM]+",
            r"^Глава\s+[IVXLCDM]+",
            r"^ОСОБЕННАЯ\s+ЧАСТЬ",
            r"^ОБЩАЯ\s+ЧАСТЬ",
            r"^Раздел\s+\d+",
            r"^Глава\s+\d+",
            r"^Комментарий",
            r"^Примечание",
            r"^Преамбула",
        ]
        
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            
            is_skip = False
            for pattern in skip_patterns:
                if re.match(pattern, stripped, re.IGNORECASE):
                    is_skip = True
                    if current:
                        blocks.append("\n".join(current))
                        current = []
                    break
            
            if is_skip:
                continue
            
            # Проверяем начало статьи
            if re.match(r"^(?:Статья|Ст\.?)\s*№?\s*[\d\.]+", stripped, re.IGNORECASE):
                if current:
                    blocks.append("\n".join(current))
                current = [stripped]
            else:
                if current is not None:
                    current.append(line)
        
        if current:
            blocks.append("\n".join(current))
        
        return blocks
    
    # ================================================================
    # 3. ПАРСИНГ БЛОКА СТАТЬИ
    # ================================================================
    
    @staticmethod
    def _parse_article_block(block: str) -> List[Dict[str, Any]]:
        """Парсит один блок статьи"""
        lines = block.split("\n")
        first_line = lines[0].strip() if lines else ""
        
        # Ищем номер статьи
        match = re.match(
            r"^(?:Статья|Ст\.?)\s*№?\s*([\d\.]+)\s*[.．]?\s*(.*)",
            first_line,
            re.IGNORECASE
        )
        
        if not match:
            return []
        
        # Получаем основной номер статьи (без частей)
        raw_code = match.group(1).strip().rstrip('.').strip()
        # Извлекаем только основную часть (до точки)
        main_code = raw_code.split('.')[0] if '.' in raw_code else raw_code
        
        title = match.group(2).strip()
        
        # Если title нет, ищем в следующих строках
        if not title and len(lines) > 1:
            for next_line in lines[1:]:
                stripped = next_line.strip()
                if stripped and not re.match(r"^(?:ч\.|\(|\d+[.)])", stripped, re.IGNORECASE):
                    title = stripped
                    break
        
        # Очищаем title от мусора
        title = ArticleParser._clean_title(title)
        
        # Извлекаем наказание из заголовка
        penalty_from_title = None
        if title:
            penalty_match = re.search(r'(?:Наказание|Штраф|Санкция)\s*[:–-]\s*([^\n]+)', title, re.IGNORECASE)
            if penalty_match:
                penalty_from_title = penalty_match.group(1).strip()
                title = re.sub(r'\s*(?:Наказание|Штраф|Санкция)\s*[:–-][^\n]+', '', title, flags=re.IGNORECASE).strip()
        
        # Собираем тело статьи
        start_idx = 2 if title and not match.group(2) else 1
        body_lines = []
        
        for i in range(start_idx, len(lines)):
            line = lines[i]
            if line.strip():
                body_lines.append(line)
        
        body = "\n".join(body_lines)
        
        # Если тело пустое
        if not body.strip():
            return [{
                "code": main_code,
                "title": title or "Без названия",
                "text": "",
                "penalty": penalty_from_title,
                "parts": []
            }]
        
        # Извлекаем наказание из тела
        penalty_from_body = ArticleParser._extract_penalty(body)
        clean_body = ArticleParser._remove_penalty_markers(body)
        clean_body = ArticleParser._clean_text(clean_body)
        
        # Проверяем, есть ли в теле маркеры частей
        parts = ArticleParser._split_into_parts(clean_body)
        
        # Если есть части
        if parts and len(parts) > 1:
            parts_list = []
            for part_marker, part_text in parts:
                part_penalty = ArticleParser._extract_penalty(part_text)
                part_clean = ArticleParser._remove_penalty_markers(part_text)
                part_clean = ArticleParser._clean_text(part_clean)
                
                parts_list.append({
                    "id": part_marker if part_marker else "",
                    "text": part_clean,
                    "penalty": part_penalty or penalty_from_body or penalty_from_title,
                })
            
            # Если у статьи есть общее наказание, но у частей нет — добавляем его
            general_penalty = penalty_from_body or penalty_from_title
            if general_penalty:
                for part in parts_list:
                    if not part['penalty']:
                        part['penalty'] = general_penalty
            
            return [{
                "code": main_code,
                "title": title or "Без названия",
                "text": "",
                "penalty": general_penalty,
                "parts": parts_list
            }]
        
        # Если нет частей — одна статья
        return [{
            "code": main_code,
            "title": title or "Без названия",
            "text": clean_body,
            "penalty": penalty_from_body or penalty_from_title,
            "parts": []
        }]
    
    # ================================================================
    # 4. ОБЪЕДИНЕНИЕ ДУБЛИКАТОВ
    # ================================================================
    
    @staticmethod
    def _merge_duplicate_articles(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Объединяет дублирующиеся статьи по коду"""
        merged = {}
        
        for article in articles:
            code = article.get('code', '')
            if not code:
                continue
            
            if code not in merged:
                merged[code] = {
                    'code': code,
                    'title': article.get('title', ''),
                    'text': '',
                    'penalty': article.get('penalty', ''),
                    'parts': []
                }
            
            # Если у статьи есть части — добавляем их
            if article.get('parts'):
                merged[code]['parts'].extend(article['parts'])
            elif article.get('text'):
                # Если нет частей, но есть текст — добавляем как часть
                merged[code]['parts'].append({
                    'id': '',
                    'text': article['text'],
                    'penalty': article.get('penalty', '')
                })
            
            # Обновляем наказание, если его нет
            if not merged[code]['penalty'] and article.get('penalty'):
                merged[code]['penalty'] = article['penalty']
        
        return list(merged.values())
    
    # ================================================================
    # 5. ОЧИСТКА ТЕКСТА
    # ================================================================
    
    @staticmethod
    def _clean_title(title: str) -> str:
        """Очищает заголовок от мусора"""
        if not title:
            return ""
        
        # Убираем маркеры
        title = re.sub(r'^ч\.\s*', '', title, flags=re.IGNORECASE)
        title = re.sub(r'^[а-яА-Я][).]\s*', '', title)
        title = re.sub(r'^[IVXLCDM]+[.．]\s*', '', title)
        title = re.sub(r'^[⭐★☆✨]+\s*', '', title)
        title = re.sub(r'^\d+[.．)]\s*', '', title)
        title = re.sub(r'^\[.*?\]\s*', '', title)  # Убираем [Федеральная/Региональная]
        
        # Убираем "Наказание" из заголовка
        title = re.sub(r'\s*(?:Наказание|Штраф|Санкция)\s*[:–-][^\n]+', '', title, flags=re.IGNORECASE).strip()
        
        # Убираем лишние запятые и точки
        title = title.rstrip('.,').strip()
        title = re.sub(r',\s*$', '', title)
        
        return title
    
    @staticmethod
    def _clean_text(text: str) -> str:
        """Очищает текст от мусора"""
        if not text:
            return ""
        
        lines = text.split('\n')
        cleaned = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Убираем маркеры
            line = re.sub(r'^ч\.\s*\d+\s*', '', line, flags=re.IGNORECASE)
            line = re.sub(r'^[а-яА-Я][).]\s*', '', line)
            line = re.sub(r'^[IVXLCDM]+[.．]\s*', '', line)
            line = re.sub(r'^\d+[.．)]\s*', '', line)
            line = re.sub(r'^[⭐★☆✨]+\s*', '', line)
            
            # Убираем цифры в начале
            if re.match(r'^\d+\s+[А-Яа-я]', line):
                line = re.sub(r'^\d+\s+', '', line)
            
            cleaned.append(line)
        
        text = '\n'.join(cleaned)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    
    @staticmethod
    def _remove_penalty_markers(text: str) -> str:
        """Убирает маркеры наказания из текста"""
        if not text:
            return ""
        
        text = re.sub(
            r'(?:Наказание|Штраф|Санкция|Ответственность)\s*[:–-][^\n]*\n?',
            '',
            text,
            flags=re.IGNORECASE
        )
        
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    
    @staticmethod
    def _extract_penalty(text: str) -> Optional[str]:
        """Извлекает наказание из текста"""
        if not text:
            return None
        
        patterns = [
            r'(?:Наказание|Штраф|Санкция|Ответственность)\s*[:–-]\s*([^\n]+)',
            r'Наказание:\s*([^\n]+)',
            r'Штраф:\s*([^\n]+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.UNICODE)
            if match:
                penalty = match.group(1).strip()
                penalty = re.sub(r'\s+', ' ', penalty)
                penalty = re.sub(r'[,;]\s*$', '', penalty)
                return penalty
        
        return None
    
    # ================================================================
    # 6. РАЗБИВКА НА ЧАСТИ
    # ================================================================
    
    @staticmethod
    def _split_into_parts(body: str) -> List[Tuple[str, str]]:
        """Разбивает тело статьи на части"""
        if not body:
            return []
        
        lines = body.split("\n")
        parts = []
        current_marker = None
        current_lines = []
        
        for line in lines:
            stripped = line.strip()
            if not stripped:
                if current_marker is not None:
                    current_lines.append("")
                continue
            
            # Ищем маркер части
            match = re.match(
                r"^(?:ч\.\s*(\d+)|(\d+)\s*[.)]|([а-яА-Я])\s*[).]|([IVXLCDM]+)\s*[.．])",
                stripped,
                re.IGNORECASE
            )
            
            if match:
                if current_marker is not None:
                    parts.append((current_marker, "\n".join(current_lines).strip()))
                
                ch = match.group(1)
                num = match.group(2)
                letter = match.group(3)
                roman = match.group(4)
                
                if ch:
                    current_marker = f"ч.{ch}"
                    rest = stripped.replace(f"ч.{ch}", "", 1).strip()
                    rest = re.sub(r'^[.)]\s*', '', rest)
                    current_lines = [rest] if rest else []
                elif num:
                    current_marker = f"ч.{num}"
                    rest = stripped.replace(f"{num}", "", 1).strip()
                    if rest and re.match(r'^[.)]', rest):
                        rest = rest[1:].strip()
                    current_lines = [rest] if rest else []
                elif letter:
                    current_marker = letter
                    rest = stripped.replace(f"{letter})", "", 1).strip()
                    if not rest:
                        rest = stripped.replace(f"{letter}.", "", 1).strip()
                    current_lines = [rest] if rest else []
                elif roman:
                    current_marker = roman
                    rest = stripped.replace(f"{roman}.", "", 1).strip()
                    current_lines = [rest] if rest else []
            else:
                if current_marker is not None:
                    current_lines.append(stripped)
                else:
                    if not current_lines:
                        current_lines.append(stripped)
                    else:
                        current_lines.append(stripped)
        
        if current_marker is not None:
            parts.append((current_marker, "\n".join(current_lines).strip()))
        
        # Если частей нет, но есть текст — возвращаем его как одну часть
        if not parts and body.strip():
            parts = [("", body)]
        
        return parts
