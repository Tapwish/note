"""Поиск кодексов (УК, АК, ПК, ДК) на странице сервера через Selenium.

ServerParser принимает URL сервера, находит на нём раздел
«Законодательная база» и извлекает ссылки на темы кодексов.
"""

import time
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from selenium import webdriver

from config import (
    BASE_URL,
    REQUEST_DELAY,
    LAWS_FORUM_KEYWORDS,
    CLOUDFLARE_MARKERS,
)
from utils.logger import log
from utils.regex import CODEX_PATTERNS


class ServerParser:
    """Находит кодексы на сервере через Selenium."""

    def __init__(self, driver: webdriver.Remote):
        """Инициализирует парсер сервера.

        Args:
            driver: Selenium WebDriver.
        """
        self.driver = driver

    def find_codexes(self, server_url: str) -> dict[str, dict[str, str]]:
        """Находит ссылки на кодексы (УК, АК, ПК, ДК) на сервере.

        Args:
            server_url: URL страницы сервера.

        Returns:
            Словарь {codex_id: {"url": str, "title": str}}.
        """
        log.info("  🔍 Поиск «Законодательной базы»...")

        laws_url = self._find_laws_section(server_url)
        if not laws_url:
            log.warning("  ⚠️ Раздел «Законодательная база» не найден")
            return {}

        log.info(f"  ✅ Законодательная база: {laws_url}")
        time.sleep(REQUEST_DELAY)

        html = self._fetch(laws_url)
        codexes = self._extract_codex_threads(html)

        log.info(f"  📋 Кодексов найдено: {len(codexes)}")
        for cid, info in codexes.items():
            log.info(f"    • {cid.upper()}: {info['title'][:50]}")

        return codexes

    def _find_laws_section(self, start_url: str, max_depth: int = 4) -> str | None:
        """BFS-поиск раздела «Законодательная база» от страницы сервера.

        Args:
            start_url: URL страницы сервера.
            max_depth: Максимальная глубина BFS.

        Returns:
            URL раздела или None.
        """
        visited: set[str] = set()
        queue: list[tuple[str, int]] = [(start_url, 0)]

        while queue:
            url, depth = queue.pop(0)
            if url in visited or depth > max_depth:
                continue
            visited.add(url)

            html = self._fetch(url)
            time.sleep(REQUEST_DELAY)
            soup = BeautifulSoup(html, "lxml")

            for link in soup.find_all("a", href=True):
                text = link.get_text(strip=True).lower()
                href = link["href"]

                if not href or not text:
                    continue
                if "/threads/" in href:
                    continue

                if any(kw in text for kw in LAWS_FORUM_KEYWORDS):
                    return urljoin(BASE_URL, href)

                if depth < max_depth and self._is_relevant_nav(href, text):
                    full = urljoin(BASE_URL, href)
                    if full not in visited:
                        queue.append((full, depth + 1))

        return None

    @staticmethod
    def _is_relevant_nav(href: str, text: str) -> bool:
        """Проверяет, стоит ли продолжать обход по этой ссылке."""
        href_lower = href.lower()
        text_lower = text.lower()

        nav_text = ("организац", "government", "государственн", "законодательн", "власть")
        nav_href = ("organizatsii", "gosudarstvenny", "government", "zakonodatel", "categories")

        return any(p in text_lower for p in nav_text) and any(p in href_lower for p in nav_href)

    def _extract_codex_threads(self, html: str) -> dict[str, dict[str, str]]:
        """Извлекает ссылки на темы кодексов из html списка тем."""
        soup = BeautifulSoup(html, "lxml")
        found: dict[str, dict[str, str]] = {}

        thread_links = soup.select(".structItem-title a[href*='/threads/']")
        if not thread_links:
            thread_links = [
                a for a in soup.find_all("a", href=True)
                if "/threads/" in a["href"]
            ]

        for link in thread_links:
            title = link.get_text(strip=True)
            href = link["href"]

            if not title or not href:
                continue

            title_lower = title.lower()
            if any(skip in title_lower for skip in ("приложение", "конституц", "закон ")):
                continue

            codex_id = self._match_codex(title)
            if codex_id and codex_id not in found:
                found[codex_id] = {
                    "url": urljoin(BASE_URL, href),
                    "title": title,
                }

        return found

    @staticmethod
    def _match_codex(title: str) -> str | None:
        """Определяет тип кодекса по названию темы."""
        for codex_id, pattern in CODEX_PATTERNS.items():
            if pattern.search(title.strip()):
                return codex_id
        return None

    def _fetch(self, url: str) -> str:
        """Загружает HTML страницы через Selenium с повторными попытками.

        Args:
            url: URL для загрузки.

        Returns:
            HTML-код.
        """
        for attempt in range(1, 4):
            try:
                self.driver.get(url)
                time.sleep(3)

                html = self.driver.page_source

                if any(marker in html for marker in CLOUDFLARE_MARKERS) or len(html) < 3000:
                    log.warning("    ⚠️ Cloudflare/защита, жду...")
                    time.sleep(12)
                    self.driver.refresh()
                    time.sleep(3)
                    html = self.driver.page_source

                if len(html) >= 5000:
                    return html

                log.warning(f"    ⚠️ Мало данных ({len(html)} байт), попытка {attempt}/3")
                time.sleep(3 * attempt)

            except Exception as e:
                log.warning(f"    ⚠️ Ошибка: {e}, попытка {attempt}/3")
                time.sleep(3 * attempt)

        return self.driver.page_source
