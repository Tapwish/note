"""Очистка HTML-контента XenForo от мусора и нормализация текста."""

import re
from bs4 import BeautifulSoup, Tag


class Cleaner:
    """Удаляет из HTML всё лишнее и возвращает чистый текст."""

    # Теги, которые нужно полностью удалить вместе с содержимым
    REMOVE_TAGS = {
        "blockquote", "script", "style", "iframe", "button",
        "svg", "img", "video", "audio", "noscript",
    }

    # Классы, элементы с которыми нужно удалить
    REMOVE_CLASS_PATTERNS = [
        re.compile(r"quote", re.I),
        re.compile(r"bbCodeBlock", re.I),
        re.compile(r"spoiler", re.I),
        re.compile(r"reaction", re.I),
        re.compile(r"signature", re.I),
        re.compile(r"attribution", re.I),
        re.compile(r"copyright", re.I),
    ]

    @staticmethod
    def clean_html(html: str) -> str:
        """Очищает HTML и возвращает чистый текст.

        Args:
            html: Исходный HTML-код.

        Returns:
            Чистый текст, пригодный для парсинга статей.
        """
        soup = BeautifulSoup(html, "lxml")

        # 1. Удаление нежелательных тегов
        for tag_name in Cleaner.REMOVE_TAGS:
            for tag in soup.find_all(tag_name):
                tag.decompose()

        # 2. Удаление элементов по классам
        for pattern in Cleaner.REMOVE_CLASS_PATTERNS:
            for tag in soup.find_all(class_=pattern):
                tag.decompose()

        # 3. Удаление элементов с data-атрибутами XenForo
        for tag in soup.find_all(attrs={"data-s9e-mediaembed": True}):
            tag.decompose()

        # 4. <br> → перенос строки
        for br in soup.find_all("br"):
            br.replace_with("\n")

        # 5. <li> → перенос строки с дефисом (каждый пункт с новой строки)
        for li in soup.find_all("li"):
            li.insert_before("\n")
            li.insert_after("\n")

        # 6. <p>, <div>, заголовки → перенос строки вокруг
        for tag in soup.find_all(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr"]):
            tag.insert_before("\n")
            tag.insert_after("\n")

        # 7. Удаление пустых тегов (без текста и без вложенных тегов с текстом)
        Cleaner._remove_empty_tags(soup)

        # 8. Извлечение текста
        text = soup.get_text()

        # 9. Очистка пробельных символов
        text = text.replace("\xa0", " ")          # Неразрывный пробел
        text = text.replace("\u200b", "")          # Zero-width space
        text = text.replace("\u2009", " ")         # Thin space
        text = text.replace("\r\n", "\n")          # Windows → Unix
        text = text.replace("\r", "\n")            # Mac → Unix

        # Удаление управляющих символов (кроме \n)
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)

        # Схлопывание множественных пробелов
        text = re.sub(r"[ \t]+", " ", text)

        # Удаление пустых строк
        lines = text.split("\n")
        lines = [line.strip() for line in lines if line.strip()]
        text = "\n".join(lines)

        # Схлопывание множественных переносов
        text = re.sub(r"\n{3,}", "\n\n", text)

        # Удаление пустых строк в начале и конце
        text = text.strip()

        return text

    @staticmethod
    def _remove_empty_tags(soup: BeautifulSoup) -> None:
        """Рекурсивно удаляет пустые теги."""
        while True:
            removed = False
            for tag in soup.find_all():
                if isinstance(tag, Tag):
                    text = tag.get_text(strip=True)
                    if not text and not tag.find_all(["img", "br", "hr"]):
                        tag.decompose()
                        removed = True
                        break
            if not removed:
                break
