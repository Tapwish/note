"""Экспорт распарсенных данных в JSON-файлы и формирование отчёта."""

import os
import re
import time
from typing import Any, Dict

import orjson

from utils.logger import logger


class Exporter:
    """Сохраняет данные серверов в JSON и создаёт report.json."""

    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

        self.report: dict[str, Any] = {
            "updatedAt": int(time.time() * 1000),
            "servers": 0,
            "articles": 0,
            "errors": [],
        }

    def save_server(self, server_name: str, server_url: str, server_laws) -> str | None:
        """Сохраняет данные сервера в JSON-файл.
        
        Args:
            server_name: Название сервера
            server_url: URL сервера
            server_laws: Объект ServerLaws
            
        Returns:
            Путь к сохранённому файлу или None
        """
        filename = self._make_filename(server_name, server_url)
        filepath = os.path.join(self.output_dir, filename)

        # Конвертируем ServerLaws в словарь
        data_dict = server_laws.to_dict()

        try:
            with open(filepath, "wb") as f:
                f.write(orjson.dumps(data_dict, option=orjson.OPT_INDENT_2))

            # Подсчёт статей
            article_count = 0
            for codex_data in data_dict.get("data", {}).values():
                articles = codex_data.get("articles", [])
                article_count += len(articles)

            self.report["articles"] += article_count
            self.report["servers"] += 1

            logger.info(f"  💾 {filename} — {article_count} статей")
            return filepath

        except Exception as e:
            logger.error(f"  ❌ Ошибка сохранения {filename}: {e}")
            self.report["errors"].append(f"Ошибка сохранения {filename}: {e}")
            return None

    def save_report(self) -> str:
        """Сохраняет report.json в директорию output."""
        filepath = os.path.join(self.output_dir, "report.json")

        self.report["updatedAt"] = int(time.time() * 1000)

        try:
            with open(filepath, "wb") as f:
                f.write(orjson.dumps(self.report, option=orjson.OPT_INDENT_2))
            logger.info(f"📄 Отчёт: {self.report['servers']} серверов, "
                       f"{self.report['articles']} статей, "
                       f"{len(self.report['errors'])} ошибок")
            return filepath
        except Exception as e:
            logger.error(f"❌ Ошибка сохранения отчёта: {e}")
            return filepath

    def add_error(self, message: str) -> None:
        """Добавляет ошибку в отчёт."""
        self.report["errors"].append(message)
        logger.error(f"  ❌ {message}")

    def _make_filename(self, server_name: str, server_url: str) -> str:
        """Формирует имя файла по названию сервера и URL."""
        # Извлекаем сегмент пути из URL
        path_match = re.search(r"/(?:categories|forums)/([^/]+)", server_url)

        if path_match:
            slug = path_match.group(1)
            slug = re.sub(r"\.\d+$", "", slug)
            # Проверяем, содержит ли slug имя сервера
            name_lower = server_name.lower().replace(" ", "_")
            if name_lower in slug:
                return f"{slug}.json"
            else:
                id_match = re.search(r"(\d+)$", slug)
                suffix = id_match.group(1) if id_match else "0"
                safe_name = server_name.lower().replace(" ", "_")
                safe_name = re.sub(r"[^\w\-]", "", safe_name)
                return f"{safe_name}-{suffix}.json"

        # Fallback
        safe_name = server_name.lower().replace(" ", "_")
        safe_name = re.sub(r"[^\w\-]", "", safe_name)
        return f"{safe_name}.json"