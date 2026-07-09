import re
from typing import Any, Optional


class ArticleParser:
    """Парсер статей — только code, title, text, penalty"""

    @staticmethod
    def parse(text: str) -> list[dict[str, Any]]:
        if not text or len(text.strip()) < 50:
            return []

        blocks = ArticleParser._split_articles(text)
        articles = []

        for block in blocks:
            parsed = ArticleParser._parse_article_block(block)
            if parsed:
                articles.extend(parsed)

        return articles

    @staticmethod
    def _split_articles(text: str) -> list[str]:
        """Разбивает текст на блоки статей (пропускает разделы и главы)"""
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

    @staticmethod
    def _parse_article_block(block: str) -> list[dict[str, Any]]:
        """Парсит один блок статьи — возвращает только 4 поля"""
        lines = block.split("\n")
        first_line = lines[0].strip() if lines else ""

        match = re.match(
            r"^(?:Статья|Ст\.?)\s*№?\s*([\d\.]+)\s*[.．]?\s*(.*)",
            first_line,
            re.IGNORECASE
        )

        if not match:
            return []

        # ============================================================
        # CODE — чистим от лишних точек и пробелов
        # ============================================================
        raw_code = match.group(1).strip()
        # Убираем точку в конце, если она есть
        code = raw_code.rstrip('.').strip()
        # Если код вида "1.1.1" — оставляем как есть
        # Если код вида "1." — убираем точку
        code = re.sub(r'^(\d+)\.$', r'\1', code)

        # ============================================================
        # TITLE — название статьи (чистим от мусора)
        # ============================================================
        title = match.group(2).strip()
        if not title and len(lines) > 1:
            for next_line in lines[1:]:
                stripped = next_line.strip()
                if stripped and not re.match(r"^(?:ч\.|\(|\d+[.)])", stripped, re.IGNORECASE):
                    title = stripped
                    break

        # Убираем "ч. " в начале title
        title = re.sub(r'^ч\.\s*', '', title, flags=re.IGNORECASE)
        title = re.sub(r'^[а-яА-Я][).]\s*', '', title)
        title = title.rstrip('.').strip()
        title = re.sub(r',\s*$', '', title)

        # ============================================================
        # BODY — тело статьи
        # ============================================================
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

        # ============================================================
        # PENALTY — извлекаем наказание
        # ============================================================
        penalty = ArticleParser._extract_penalty(body)

        # ============================================================
        # УДАЛЯЕМ НАКАЗАНИЕ ИЗ ТЕКСТА
        # ============================================================
        clean_body = ArticleParser._remove_markers(body)

        # ============================================================
        # РАЗБИВАЕМ НА ЧАСТИ
        # ============================================================
        parts = ArticleParser._split_parts(clean_body)

        if not parts:
            # Нет частей — одна статья
            return [{
                "code": code,
                "title": title or "Без названия",
                "text": ArticleParser._clean_text(clean_body),
                "penalty": penalty,
            }]

        # Есть части — по одной записи на часть
        results = []
        for part_marker, part_text in parts:
            # Чистим маркер части
            marker = part_marker.replace("ч.", "").strip()
            if marker:
                part_code = f"{code} ч.{marker}"
            else:
                part_code = code

            # Для каждой части ищем наказание отдельно
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
            # Убираем "ч. " в начале
            line = re.sub(r'^ч\.\s*', '', line, flags=re.IGNORECASE)
            # Убираем звезды в начале
            line = re.sub(r'^[⭐★☆✨]+\s*', '', line)
            # Убираем буквенные маркеры в начале
            line = re.sub(r'^[а-яА-Я][).]\s*', '', line)
            # Убираем лишние точки в конце
            line = re.sub(r'\.\.+', '.', line)
            cleaned.append(line)

        text = '\n'.join(cleaned)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    @staticmethod
    def _remove_markers(text: str) -> str:
        """Убирает маркеры наказания из текста"""
        if not text:
            return ""

        # Удаляем строки с наказанием (включая перенос)
        text = re.sub(
            r'(?:Наказание|Штраф|Санкция|Ответственность|Мера\s+наказания)\s*[:–-][^\n]*\n?',
            '',
            text,
            flags=re.IGNORECASE
        )

        # Убираем лишние переносы
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
                # Убираем лишние точки
                penalty = re.sub(r'\.\.+', '.', penalty)
                return penalty

        # Если маркер не найден, ищем просто "наказание" в тексте
        match = re.search(
            r'наказание\s+([^\n]{5,})',
            text,
            re.IGNORECASE | re.UNICODE
        )
        if match:
            penalty = match.group(1).strip()
            if len(penalty) < 100:
                return penalty

        return None

    @staticmethod
    def _split_parts(body: str) -> list[tuple[str, str]]:
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