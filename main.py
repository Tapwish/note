#!/usr/bin/env python3
import os
import sys
import time
import json
import subprocess
from datetime import datetime
from typing import Dict, List

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

from parsers.forum_parser import ForumParser
from parsers.codex_parser import CodexParser
from utils.logger import logger
from models.law_models import ServerLaws, Codex, Article
from config import config


class MajesticLawParser:
    def __init__(self):
        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        
        self.forum_parser = ForumParser(self.driver)
        self.codex_parser = CodexParser(self.driver)
        
        self.total_articles = 0
        self.servers_processed = 0
        
    def run(self):
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser")
            start_time = time.time()
            
            # Создаём папку
            os.makedirs(config.DATA_DIR, exist_ok=True)
            
            # ... ТВОЙ КОД ПАРСИНГА ...
            # (здесь ты парсишь серверы и сохраняешь JSON)
            
            elapsed_time = time.time() - start_time
            logger.success(f"✅ Готово за {elapsed_time:.2f} сек")
            logger.success(f"✅ Серверов: {self.servers_processed}, статей: {self.total_articles}")
            
            # ============================================================
            # 🔥 АВТОКОММИТ ПОСЛЕ ПАРСИНГА
            # ============================================================
            self._commit_and_push()
            
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
            import traceback
            traceback.print_exc()
        finally:
            self.driver.quit()
    
    def _commit_and_push(self):
        """Коммитит и пушит JSON-файлы в репозиторий"""
        try:
            logger.info("📤 Коммитим изменения...")
            
            # Проверяем, есть ли изменения
            result = subprocess.run(
                ["git", "status", "--porcelain", "data/laws/"],
                capture_output=True,
                text=True
            )
            
            if not result.stdout.strip():
                logger.info("✅ Нет изменений для коммита")
                return
            
            # Добавляем файлы
            subprocess.run(["git", "add", "data/laws/*.json"], check=True)
            subprocess.run(["git", "add", "data/report.json"], check=True)
            
            # Коммитим
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            subprocess.run(
                ["git", "commit", "-m", f"🔄 Update laws {timestamp}"],
                check=True
            )
            
            # Пушим
            subprocess.run(["git", "push"], check=True)
            
            logger.success("✅ Изменения закоммичены и запушены!")
            
        except subprocess.CalledProcessError as e:
            logger.error(f"❌ Ошибка при коммите: {str(e)}")
        except Exception as e:
            logger.error(f"❌ Неожиданная ошибка: {str(e)}")


def main():
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()
