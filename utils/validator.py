"""Валидация распарсенных статей и данных серверов."""

from typing import Any

from utils.logger import log


class Validator:
    """Проверяет корректность структуры и данных статей."""

    @staticmethod
    def validate_server_data(data: dict, server_name: str) -> bool:
        """Проверяет данные сервера на корректность.

        Args:
            data: Данные сервера в формате {UK: {url, articles}, ...}.
            server_name: Название сервера (для логов).

        Returns:
            True, если данные корректны.
        """
        if not data:
            log.warning(f"  ⚠️ [{server_name}] Нет данных")
            return False

        for codex_id in ("uk", "ak", "pk", "dk"):
            codex = data.get(codex_id.upper())
            if not codex:
                continue

            url = codex.get("url", "")
            if not url:
                log.warning(f"  ⚠️ [{server_name}/{codex_id.upper()}] Нет URL")
                return False

            articles = codex.get("articles", [])
            if not articles:
                log.warning(f"  ⚠️ [{server_name}/{codex_id.upper()}] Нет статей")
                return False

            seen_codes: set[str] = set()
            for i, article in enumerate(articles):
                code = article.get("code", "")
                title = article.get("title", "")
                text = article.get("text", "")

                if not code:
                    log.warning(
                        f"  ⚠️ [{server_name}/{codex_id.upper()}] "
                        f"Статья #{i}: пустой code"
                    )
                    return False

                if not title:
                    log.warning(
                        f"  ⚠️ [{server_name}/{codex_id.upper()}] "
                        f"Статья #{i} ({code}): пустой title"
                    )
                    return False

                if not text:
                    log.warning(
                        f"  ⚠️ [{server_name}/{codex_id.upper()}] "
                        f"Статья #{i} ({code}): пустой text"
                    )
                    return False

                if code in seen_codes:
                    log.warning(
                        f"  ⚠️ [{server_name}/{codex_id.upper()}] "
                        f"Дубликат code: {code}"
                    )
                    return False
                seen_codes.add(code)

        log.info(f"  ✔ [{server_name}] Валидация пройдена")
        return True

    @staticmethod
    def validate_article(article: dict) -> bool:
        """Проверяет отдельную статью на корректность.

        Args:
            article: Словарь статьи.

        Returns:
            True, если статья корректна.
        """
        required = {"code", "title", "text", "jurisdiction", "penalty", "wanted_stars"}
        if not required.issubset(article.keys()):
            return False
        if not article.get("code"):
            return False
        if not article.get("title"):
            return False
        if not article.get("text"):
            return False
        return True
