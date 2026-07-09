import re
from typing import Any, Optional, List, Dict, Tuple


class ArticleParser:
    """
    Парсит текст кодекса в структурированные статьи
    Выходные поля: code, title, text, penalty
    """
    
    @staticmethod
    def parse(text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст кодекса в список статей
        """
        if not text or len(text.strip()) < 50:
            return []
        
        # Разбиваем на блоки статей
        blocks = ArticleParser._split_articles(text)
        articles = []
        
        for block in blocks:
            parsed = ArticleParser._parse_article_block(block)
            if parsed:
                articles.extend(parsed)
        
        return articles
    
    @staticmethod
    def _split_articles(text: str) -> List[str]:
        """
        Разбивает текст на блоки статей
        Пропускает разделы, главы, комментарии
        """
        lines = text.split("\n")
        blocks = []
        current = []
        
        # Паттерны для пропуска
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
        ]
        
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            
            # Проверяем, не нужно ли пропустить
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
            
            # Проверяем, начинается ли строка со "Статья"
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
    
    @staticmethod
    def _parse_article_block(block: str) -> List[Dict[str, Any]]:
        """
        Парсит один блок статьи
        Возвращает список статей (если есть части — несколько)
        """
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
        
        # === CODE ===
        raw_code = match.group(1).strip()
        code = raw_code.rstrip('.').strip()
        
        # === TITLE ===
        title = match.group(2).strip()
        if not title and len(lines) > 1:
            for next_line in lines[1:]:
                stripped = next_line.strip()
                if stripped and not re.match(r"^(?:ч\.|\(|\d+[.)])", stripped, re.IGNORECASE):
                    title = stripped
                    break
        
        # Чистим title
        title = re.sub(r'^ч\.\s*', '', title, flags=re.IGNORECASE)
        title = re.sub(r'^[а-яА-Я][).]\s*', '', title)
        title = title.rstrip('.').strip()
        title = re.sub(r',\s*$', '', title)
        
        # === BODY ===
        start_idx = 2 if title and not match.group(2) else 1
        body_lines = [l for l in lines[start_idx:] if l.strip()]
        body = "\n".join(body_lines)
        
        if not body.strip():
            return [{
                "code": code,
                "title": title or "Без названия",
                "text": "",
                "penalty": None,
            }]
        
        # === PENALTY ===
        penalty = ArticleParser._extract_penalty(body)
        clean_body = ArticleParser._remove_markers(body)
        
        # === РАЗБИВАЕМ НА ЧАСТИ ===
        parts = ArticleParser._split_parts(clean_body)
        
        if not parts:
            return [{
                "code": code,
                "title": title or "Без названия",
                "text": ArticleParser._clean_text(clean_body),
                "penalty": penalty,
            }]
        
        # Есть части
        results = []
        for part_marker, part_text in parts:
            marker = part_marker.replace("ч.", "").strip()
            part_code = f"{code} ч.{marker}" if marker else code
            
            part_penalty = ArticleParser._extract_penalty(part_text)
            part_clean = ArticleParser._remove_markers(part_text)
            
            results.append({
                "code": part_code,
                "title": title or "Без названия",
                "text": ArticleParser._clean_text(part_clean),
                "penalty": part_penalty if part_penalty else penalty,
            })
        
        return results
    
    # ================================================================
    # ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    # ================================================================
    
    @staticmethod
    def _clean_text(text: str) -> str:
        """Убирает мусор в начале строк"""
        if not text:
            return ""
        
        lines = text.split('\n')
        cleaned = []
        for line in lines:
            line = re.sub(r'^ч\.\s*', '', line, flags=re.IGNORECASE)
            line = re.sub(r'^[⭐★☆✨]+\s*', '', line)
            line = re.sub(r'^[а-яА-Я][).]\s*', '', line)
            cleaned.append(line)
        
        text = '\n'.join(cleaned)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    
    @staticmethod
    def _remove_markers(text: str) -> str:
        """Убирает маркеры наказания из текста"""
        if not text:
            return ""
        
        text = re.sub(
            r'(?:Наказание|Штраф|Санкция|Ответственность|Мера\s+наказания)\s*[:–-][^\n]*\n?',
            '',
            text,
            flags=re.IGNORECASE
        )
        
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    
    @staticmethod
    def _extract_penalty(text: str) -> Optional[str]:
        """Извлекает наказание из текста"""
        patterns = [
            r'(?:Наказание|Штраф|Санкция|Ответственность|Мера\s+наказания)\s*[:–-]\s*([^\n]+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.UNICODE)
            if match:
                penalty = match.group(1).strip()
                penalty = re.sub(r'\s+', ' ', penalty)
                penalty = re.sub(r'[,;]\s*$', '', penalty)
                return penalty
        
        return None
    
    @staticmethod
    def _split_parts(body: str) -> List[Tuple[str, str]]:
        """Разбивает тело статьи на части"""
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
                    current_lines.append(stripped)
        
        if current_marker is not None:
            parts.append((current_marker, "\n".join(current_lines).strip()))
        
        return parts
