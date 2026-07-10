# parsers/article_parser.py

import re
from typing import Any, Optional, List, Dict, Tuple


class ArticleParser:
    """
    Парсит текст кодекса в структурированные статьи
    САМ создаёт структуру: код, текст, части, наказания
    """
    
    @staticmethod
    def parse(text: str, codex_type: str = 'uk') -> Dict[str, Any]:
        if not text or len(text.strip()) < 50:
            return {"theory": "", "articles": []}
        
        # 1. Извлекаем теорию
        theory, remaining = ArticleParser._extract_theory(text)
        
        # 2. Разбиваем на блоки статей
        blocks = ArticleParser._split_articles(remaining)
        
        # 3. Парсим каждый блок
        all_articles = []
        for block in blocks:
            parsed = ArticleParser._parse_article_block(block)
            if parsed:
                all_articles.extend(parsed)
        
        # 4. 🔥 ГРУППИРУЕМ ПО ОСНОВНОМУ НОМЕРУ
        all_articles = ArticleParser._group_articles_by_code(all_articles)
        
        # 5. Добавляем ID
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
        lines = text.split('\n')
        theory_lines = []
        remaining_lines = []
        found_penalty_article = False
        
        for i, line in enumerate(lines):
            stripped = line.strip()
            
            if re.match(r"^(?:Статья|Ст\.?)\s*№?\s*[\d\.]+", stripped, re.IGNORECASE):
                check_lines = lines[i:min(i+10, len(lines))]
                check_text = '\n'.join(check_lines)
                
                if ArticleParser._has_penalty(check_text):
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
        
        return '\n'.join(theory_lines).strip(), '\n'.join(remaining_lines).strip()
    
    @staticmethod
    def _has_penalty(text: str) -> bool:
        return bool(re.search(r'(?:Наказание|Штраф|Санкция|Ответственность)', text, re.IGNORECASE))
    
    # ================================================================
    # 2. РАЗБИВКА НА БЛОКИ
    # ================================================================
    
    @staticmethod
    def _split_articles(text: str) -> List[str]:
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
    # 3. ПАРСИНГ ОДНОГО БЛОКА
    # ================================================================
    
    @staticmethod
    def _parse_article_block(block: str) -> List[Dict[str, Any]]:
        lines = block.split("\n")
        first_line = lines[0].strip() if lines else ""
        
        match = re.match(
            r"^(?:Статья|Ст\.?)\s*№?\s*([\d\.]+)\s*[.．]?\s*(.*)",
            first_line,
            re.IGNORECASE
        )
        
        if not match:
            return []
        
        raw_code = match.group(1).strip().rstrip('.').strip()
        title = match.group(2).strip()
        
        if not title and len(lines) > 1:
            for next_line in lines[1:]:
                stripped = next_line.strip()
                if stripped and not re.match(r"^(?:ч\.|\(|\d+[.)])", stripped, re.IGNORECASE):
                    title = stripped
                    break
        
        title = ArticleParser._clean_title(title)
        
        # Извлекаем наказание из заголовка
        penalty_from_title = None
        if title:
            penalty_match = re.search(r'(?:Наказание|Штраф|Санкция)\s*[:–-]\s*([^\n]+)', title, re.IGNORECASE)
            if penalty_match:
                penalty_from_title = penalty_match.group(1).strip()
                title = re.sub(r'\s*(?:Наказание|Штраф|Санкция)\s*[:–-][^\n]+', '', title, flags=re.IGNORECASE).strip()
        
        # Собираем тело
        start_idx = 2 if title and not match.group(2) else 1
        body_lines = []
        
        for i in range(start_idx, len(lines)):
            line = lines[i]
            if line.strip():
                body_lines.append(line)
        
        body = "\n".join(body_lines)
        
        if not body.strip():
            return [{
                "code": raw_code,
                "title": title or "Без названия",
                "text": "",
                "penalty": penalty_from_title,
                "parts": []
            }]
        
        penalty_from_body = ArticleParser._extract_penalty(body)
        clean_body = ArticleParser._remove_penalty_markers(body)
        clean_body = ArticleParser._clean_text(clean_body)
        
        # 🔥 РАЗБИВАЕМ НА ЧАСТИ
        parts = ArticleParser._split_into_parts(clean_body)
        
        # Если есть части (больше 1)
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
            
            general_penalty = penalty_from_body or penalty_from_title
            
            return [{
                "code": raw_code,
                "title": title or "Без названия",
                "text": "",
                "penalty": general_penalty,
                "parts": parts_list
            }]
        
        # Если нет частей — одна статья
        return [{
            "code": raw_code,
            "title": title or "Без названия",
            "text": clean_body,
            "penalty": penalty_from_body or penalty_from_title,
            "parts": []
        }]
    
    # ================================================================
    # 4. 🔥 ГРУППИРОВКА ПО ОСНОВНОМУ НОМЕРУ
    # ================================================================
    
    @staticmethod
    def _group_articles_by_code(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Группирует статьи по основному номеру (6.1 и 6.2 → статья 6)"""
        grouped = {}
        
        for article in articles:
            code = article.get('code', '')
            if not code:
                continue
            
            # Извлекаем основной номер
            main_code = code
            if '.' in code:
                main_code = code.split('.')[0]
            elif ' ' in code:
                main_code = code.split(' ')[0]
            
            # Проверяем, что номер состоит из цифр
            if not re.match(r'^\d+$', main_code):
                main_code = code
            
            if main_code not in grouped:
                grouped[main_code] = {
                    'code': main_code,
                    'title': article.get('title', ''),
                    'text': '',
                    'penalty': article.get('penalty', ''),
                    'parts': []
                }
            
            # Если у статьи есть части
            if article.get('parts') and len(article['parts']) > 0:
                for part in article['parts']:
                    # Проверяем, нет ли такой части уже
                    exists = False
                    for existing in grouped[main_code]['parts']:
                        if existing.get('text') == part.get('text'):
                            exists = True
                            break
                    if not exists and part.get('text'):
                        grouped[main_code]['parts'].append(part)
            
            # Если есть текст и нет частей
            elif article.get('text'):
                if not grouped[main_code]['text']:
                    grouped[main_code]['text'] = article['text']
                else:
                    # Добавляем как часть
                    exists = False
                    for existing in grouped[main_code]['parts']:
                        if existing.get('text') == article['text']:
                            exists = True
                            break
                    if not exists:
                        grouped[main_code]['parts'].append({
                            'id': '',
                            'text': article['text'],
                            'penalty': article.get('penalty', '')
                        })
            
            # Обновляем наказание
            if article.get('penalty'):
                if not grouped[main_code]['penalty']:
                    grouped[main_code]['penalty'] = article['penalty']
            
            # Обновляем заголовок
            if article.get('title') and article['title'] != 'Без названия':
                if grouped[main_code]['title'] == 'Без названия' or not grouped[main_code]['title']:
                    grouped[main_code]['title'] = article['title']
        
        # Чистим результат
        result = []
        for code, data in grouped.items():
            # Убираем дубликаты частей
            unique_parts = []
            seen = set()
            for part in data['parts']:
                text = part.get('text', '').strip()
                if text and text not in seen:
                    seen.add(text)
                    unique_parts.append(part)
            data['parts'] = unique_parts
            
            # Если есть части, текст не нужен
            if data['parts']:
                data['text'] = ''
            
            result.append(data)
        
        return result
    
    # ================================================================
    # 5. ОЧИСТКА ТЕКСТА
    # ================================================================
    
    @staticmethod
    def _clean_title(title: str) -> str:
        if not title:
            return ""
        
        title = re.sub(r'^ч\.\s*', '', title, flags=re.IGNORECASE)
        title = re.sub(r'^[а-яА-Я][).]\s*', '', title)
        title = re.sub(r'^[IVXLCDM]+[.．]\s*', '', title)
        title = re.sub(r'^[⭐★☆✨]+\s*', '', title)
        title = re.sub(r'^\d+[.．)]\s*', '', title)
        title = re.sub(r'^\[.*?\]\s*', '', title)
        
        title = re.sub(r'\s*(?:Наказание|Штраф|Санкция)\s*[:–-][^\n]+', '', title, flags=re.IGNORECASE).strip()
        title = title.rstrip('.,').strip()
        title = re.sub(r',\s*$', '', title)
        
        return title
    
    @staticmethod
    def _clean_text(text: str) -> str:
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
            line = re.sub(r'^\[.*?\]\s*', '', line)
            
            if re.match(r'^\d+\s+[А-Яа-я]', line):
                line = re.sub(r'^\d+\s+', '', line)
            
            cleaned.append(line)
        
        text = '\n'.join(cleaned)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    
    @staticmethod
    def _remove_penalty_markers(text: str) -> str:
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
        
        if not parts and body.strip():
            parts = [("", body)]
        
        return parts
