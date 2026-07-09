#!/usr/bin/env python3
import os
import sys
import time
import json
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
        # Создаём папку ДО запуска браузера
        self._ensure_directories()
        
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
        self.start_time = time.time()
    
    def _ensure_directories(self):
        """Создаёт все необходимые папки"""
        # Создаём папку data/laws
        os.makedirs(config.DATA_DIR, exist_ok=True)
        logger.info(f"📁 Папка создана: {config.DATA_DIR}")
        
        # Создаём пустой report.json если его нет
        report_path = config.REPORT_FILE
        if not os.path.exists(report_path):
            os.makedirs(os.path.dirname(report_path), exist_ok=True)
            with open(report_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "updatedAt": int(datetime.now().timestamp() * 1000),
                    "servers_processed": 0,
                    "total_articles": 0,
                    "elapsedTime": 0
                }, f, ensure_ascii=False, indent=2)
            logger.info(f"📄 Создан report.json")
    
    def run(self):
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser")
            
            # ============================================================
            # ТВОЙ КОД ПАРСИНГА (вставь сюда)
            # ============================================================
            
            # ============================================================
            # СОХРАНЯЕМ РЕЗУЛЬТАТЫ
            # ============================================================
            elapsed_time = time.time() - self.start_time
            self._save_report(elapsed_time)
            
            logger.success(f"✅ Готово за {elapsed_time:.2f} сек")
            logger.success(f"✅ Серверов: {self.servers_processed}, статей: {self.total_articles}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
            import traceback
            traceback.print_exc()
        finally:
            self.driver.quit()
    
    def _save_report(self, elapsed_time: float):
        """Сохраняет отчёт"""
        report = {
            "updatedAt": int(datetime.now().timestamp() * 1000),
            "servers_processed": self.servers_processed,
            "total_articles": self.total_articles,
            "elapsedTime": round(elapsed_time, 2)
        }
        
        os.makedirs(config.DATA_DIR, exist_ok=True)
        with open(config.REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        logger.info(f"📄 Отчёт сохранён: {config.REPORT_FILE}")


def main():
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()
