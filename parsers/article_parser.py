# parsers/article_parser.py

import re
import json
from typing import Any, Optional, List, Dict, Tuple


class ArticleParser:
    """
    Парсит текст кодекса в структурированные статьи
    Выходные поля: id, code, title, text, penalty, parts
    """
    
    @staticmethod
    def parse(text: str, codex_type: str = 'uk') -> Dict[str, Any]:
        """
        Парсит текст кодекса в структурированный JSON
        Возвращает: {
            "theory": "...",
            "articles": [...]
        }
        """
        if not text or len(text.strip()) < 50:
            return {"theory": "", "articles": []}
        
        # 1. ИЗВЛЕКАЕМ ТЕОРИЮ (до первой статьи с наказанием)
        theory, remaining = ArticleParser._extract_theory(text)
        
        # 2. РАЗБИВАЕМ НА БЛОКИ СТАТЕЙ
        blocks = ArticleParser._split_articles(remaining)
        
        # 3. ПАРСИМ КАЖДЫЙ БЛОК
        all_articles = []
        for block in blocks:
            parsed = ArticleParser._parse_article_block(block, codex_type)
            if parsed:
                all_articles.extend(parsed)
        
        # 4. УДАЛЯЕМ ДУБЛИКАТЫ
        all_articles = ArticleParser._remove_duplicates(all_articles)
        
        # 5. СОРТИРУЕМ СТАТЬИ
        all_articles = ArticleParser._sort_articles(all_articles)
        
        # 6. ДОБАВЛЯЕМ ID
        for i, article in enumerate(all_articles):
            if 'id' not in article:
                article['id'] = f"{codex_type}-{i+1}"
        
        return {
            "theory": theory,
            "articles": all_articles
        }
    
    # ================================================================
    # 1. ИЗВЛЕЧЕНИЕ ТЕОРИИ (ДО ПЕРВОЙ СТАТЬИ С НАКАЗАНИЕМ)
    # ================================================================
    
    @staticmethod
    def _extract_theory(text: str) -> Tuple[str, str]:
        """
        Извлекает теорию до первой статьи, которая содержит наказание
        """
        lines = text.split('\n')
        theory_lines = []
        remaining_lines = []
        found_penalty_article = False
        
        for i, line in enumerate(lines):
            stripped = line.strip()
            
            if re.match(r"^(?:Статья|Ст\.?)\s*№?\s*[\d\.]+", stripped, re.IGNORECASE):
                check_lines = lines[i:min(i+15, len(lines))]
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
        if re.search(r'(?:Наказание|Штраф|Санкция|Ответственность)', text, re.IGNORECASE):
            return True
        if re.search(r'"penalty"\s*:\s*"[^"]+"', text):
            return True
        return False
    
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
            r"^РАЗДЕЛ\s+\d+",
            r"^ГЛАВА\s+\d+",
            r"^Комментарий",
            r"^Примечание",
            r"^Последнее редактирование",
            r"^Список использованных источников",
            r"^Источники:",
            r"^Ссылки:",
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
    def _parse_article_block(block: str, codex_type: str) -> List[Dict[str, Any]]:
        """Парсит один блок статьи"""
        lines = block.split("\n")
        first_line = lines[0].strip() if lines else ""
        
        match = re.match(
            r"^(?:Статья|Ст\.?)\s*№?\s*([\d\.]+)\s*[.．]?\s*(.*)",
            first_line,
            re.IGNORECASE
        )
        
        if not match:
            return []
        
        raw_code = match.group(1).strip()
        code = raw_code.rstrip('.').strip()
        
        title = match.group(2).strip()
        if not title and len(lines) > 1:
            for next_line in lines[1:]:
                stripped = next_line.strip()
                if stripped and not re.match(r"^(?:ч\.|\(|\d+[.)])", stripped, re.IGNORECASE):
                    title = stripped
                    break
        
        title = ArticleParser._clean_title(title)
        
        penalty_from_title = ArticleParser._extract_penalty_from_text(title)
        if penalty_from_title:
            title = re.sub(r'\s*(?:Наказание|Штраф|Санкция)\s*[:–-][^\n]+', '', title, flags=re.IGNORECASE).strip()
        
        start_idx = 2 if title and not match.group(2) else 1
        body_lines = []
        
        for i in range(start_idx, len(lines)):
            line = lines[i]
            stripped = line.strip()
            if stripped:
                body_lines.append(line)
        
        body = "\n".join(body_lines)
        
        if not body.strip():
            return [{
                "id": "",
                "code": code,
                "title": title or "Без названия",
                "text": "",
                "penalty": penalty_from_title,
                "parts": []
            }]
        
        penalty_from_body = ArticleParser._extract_penalty_from_text(body)
        clean_body = ArticleParser._remove_penalty_markers(body)
        
        parts = ArticleParser._split_into_parts(clean_body)
        
        if not parts:
            return [{
                "id": "",
                "code": code,
                "title": title or "Без названия",
                "text": ArticleParser._clean_text(clean_body),
                "penalty": penalty_from_body or penalty_from_title,
                "parts": []
            }]
        
        return ArticleParser._group_parts(code, title, parts, penalty_from_body, penalty_from_title)
    
    # ================================================================
    # 4. ГРУППИРОВКА ЧАСТЕЙ
    # ================================================================
    
    @staticmethod
    def _group_parts(code: str, title: str, parts: List[Tuple[str, str]], 
                     penalty_from_body: Optional[str], penalty_from_title: Optional[str]) -> List[Dict[str, Any]]:
        """Группирует части в одну статью с полем parts"""
        
        main_code = code
        if '.' in code:
            main_code = code.split('.')[0]
        elif 'ч' in code:
            main_code = code.split('ч')[0].strip()
        elif ' ' in code:
            main_code = code.split(' ')[0].strip()
        
        parts_list = []
        for part_marker, part_text in parts:
            clean_text = ArticleParser._clean_part_text(part_text)
            
            part_penalty = ArticleParser._extract_penalty_from_text(part_text)
            if not part_penalty:
                part_penalty = penalty_from_body or penalty_from_title
            
            part_id = part_marker if part_marker else ""
            
            parts_list.append({
                "id": part_id,
                "text": clean_text,
                "penalty": part_penalty
            })
        
        general_penalty = penalty_from_body or penalty_from_title
        
        if general_penalty:
            for part in parts_list:
                if not part['penalty']:
                    part['penalty'] = general_penalty
        
        return [{
            "id": "",
            "code": main_code,
            "title": title or "Без названия",
            "text": "",
            "penalty": general_penalty,
            "parts": parts_list
        }]
    
    # ================================================================
    # 5. ОЧИСТКА ТЕКСТА
    # ================================================================
    
    @staticmethod
    def _clean_title(title: str) -> str:
        """Очищает заголовок от мусора"""
        if not title:
            return ""
        
        title = re.sub(r'^ч\.\s*', '', title, flags=re.IGNORECASE)
        title = re.sub(r'^[а-яА-Я][).]\s*', '', title)
        title = re.sub(r'^[IVXLCDM]+[.．]\s*', '', title)
        title = re.sub(r'^[⭐★☆✨]+\s*', '', title)
        title = re.sub(r'^\d+[.．)]\s*', '', title)
        
        title = re.sub(r'\s*(?:Наказание|Штраф|Санкция)\s*[:–-][^\n]+', '', title, flags=re.IGNORECASE).strip()
        
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
            
            line = re.sub(r'^ч\.\s*\d+\s*', '', line, flags=re.IGNORECASE)
            line = re.sub(r'^[а-яА-Я][).]\s*', '', line)
            line = re.sub(r'^[IVXLCDM]+[.．]\s*', '', line)
            line = re.sub(r'^\d+[.．)]\s*', '', line)
            line = re.sub(r'^[⭐★☆✨]+\s*', '', line)
            
            if re.match(r'^\d+\s+[А-Яа-я]', line):
                line = re.sub(r'^\d+\s+', '', line)
            
            cleaned.append(line)
        
        text = '\n'.join(cleaned)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    
    @staticmethod
    def _clean_part_text(text: str) -> str:
        """Специальная очистка для текста части"""
        if not text:
            return ""
        
        lines = text.split('\n')
        cleaned = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            line = re.sub(r'^ч\.\s*\d+\s*', '', line, flags=re.IGNORECASE)
            line = re.sub(r'^[а-яА-Я][).]\s*', '', line)
            line = re.sub(r'^[IVXLCDM]+[.．]\s*', '', line)
            line = re.sub(r'^\d+[.．)]\s*', '', line)
            line = re.sub(r'^[⭐★☆✨]+\s*', '', line)
            
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
            r'(?:Наказание|Штраф|Санкция|Ответственность|Мера\s+наказания)\s*[:–-][^\n]*\n?',
            '',
            text,
            flags=re.IGNORECASE
        )
        
        text = re.sub(r'^ч\.\s*\d+\s*', '', text, flags=re.IGNORECASE | re.MULTILINE)
        text = re.sub(r'^[а-яА-Я][).]\s*', '', text, flags=re.MULTILINE)
        text = re.sub(r'^[IVXLCDM]+[.．]\s*', '', text, flags=re.MULTILINE)
        text = re.sub(r'^\d+[.．)]\s*', '', text, flags=re.MULTILINE)
        text = re.sub(r'^[⭐★☆✨]+\s*', '', text, flags=re.MULTILINE)
        
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    
    # ================================================================
    # 6. ИЗВЛЕЧЕНИЕ НАКАЗАНИЯ
    # ================================================================
    
    @staticmethod
    def _extract_penalty_from_text(text: str) -> Optional[str]:
        """Извлекает наказание из текста"""
        patterns = [
            r'(?:Наказание|Штраф|Санкция|Ответственность|Мера\s+наказания)\s*[:–-]\s*([^\n]+)',
            r'(?:Наказание|Штраф|Санкция)\s*[:–-]\s*([^\n]+)',
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
    # 7. РАЗБИВКА НА ЧАСТИ
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
            
            match = re.match(
                r"^(?:ч\.\s*(\d+)|(\d+)\s*[.)]|([а-яА-Я])\s*[).]|([IVXLCDM]+)\s*[.．]|(?:пункт|п\.)\s*(\d+))",
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
                punkt = match.group(5)
                
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
                elif punkt:
                    current_marker = f"п.{punkt}"
                    rest = stripped.replace(f"п.{punkt}", "", 1).strip()
                    rest = re.sub(r'^[.)]\s*', '', rest)
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
        
        if not parts and body.strip():
            clean = ArticleParser._remove_penalty_markers(body)
            parts = [("", clean)]
        
        return parts
    
    # ================================================================
    # 8. УДАЛЕНИЕ ДУБЛИКАТОВ
    # ================================================================
    
    @staticmethod
    def _remove_duplicates(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Удаляет дублирующиеся статьи"""
        seen = set()
        unique = []
        
        for article in articles:
            key = f"{article.get('code', '')}|{article.get('title', '')}"
            
            if article.get('parts'):
                for part in article['parts']:
                    key += f"|{part.get('id', '')}|{part.get('text', '')[:50]}"
            
            if key not in seen:
                seen.add(key)
                unique.append(article)
        
        return unique
    
    # ================================================================
    # 9. СОРТИРОВКА СТАТЕЙ
    # ================================================================
    
    @staticmethod
    def _sort_articles(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Сортирует статьи по номеру"""
        def sort_key(article):
            code = article.get('code', '')
            match = re.search(r'(\d+)', code)
            if match:
                return int(match.group(1))
            return 9999
        
        return sorted(articles, key=sort_key)
