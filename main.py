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
from utils.exporter import Exporter
from utils.validator import Validator
from models.law_models import ServerLaws, Codex, Article
from config import config


class MajesticLawParser:
    def __init__(self):
        chrome_options = Options()
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        # GitHub Actions
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        self.forum_parser = ForumParser(self.driver)
        self.codex_parser = CodexParser(self.driver)
        self.exporter = Exporter(config.DATA_DIR)
        self.validator = Validator()
        
        self.servers_processed = 0
        self.total_articles = 0
        self.errors = []
    
    def run(self):
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser (GitHub Actions)")
            start_time = time.time()
            
            for server in config.SERVERS:
                self._process_server(server)
                time.sleep(1)
            
            elapsed_time = time.time() - start_time
            self._create_report(elapsed_time)
            
            logger.success(f"✅ Готово за {elapsed_time:.2f} сек")
            logger.success(f"Серверов: {self.servers_processed}, статей: {self.total_articles}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
            import traceback
            traceback.print_exc()
        finally:
            self.driver.quit()
    
    def _process_server(self, server: Dict[str, str]):
        server_name = server.get('name', 'Unknown')
        section_url = server.get('url', '')
        
        logger.info(f"\n{'='*50}")
        logger.info(f"🏢 {server_name}")
        logger.info(f"{'='*50}")
        
        try:
            codex_links = self.forum_parser.find_codexes_in_section(section_url)
            
            if not codex_links:
                logger.warning(f"Кодексы не найдены для {server_name}")
                return
            
            server_laws = ServerLaws(server_name=server_name)
            server_articles = 0
            
            for codex_type, codex_url in codex_links.items():
                logger.info(f"📖 Парсинг {codex_type}...")
                
                result = self.codex_parser.parse_codex(codex_url, self.driver)
                articles_data = result.get('articles', [])
                
                if articles_data:
                    articles = [Article(**a) for a in articles_data]
                    server_laws.data[codex_type] = Codex(url=codex_url, articles=articles)
                    server_articles += len(articles)
                    self.total_articles += len(articles)
                    logger.success(f"  ✅ {codex_type}: {len(articles)} статей")
                else:
                    logger.warning(f"  ⚠️ {codex_type}: 0 статей")
            
            if server_articles > 0:
                # Сохраняем JSON с именем сервера
                filename = self._get_filename(server_name)
                filepath = os.path.join(config.DATA_DIR, filename)
                os.makedirs(config.DATA_DIR, exist_ok=True)
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(server_laws.to_dict(), f, ensure_ascii=False, indent=2)
                
                self.servers_processed += 1
                logger.success(f"✅ {server_name}: {server_articles} статей -> {filename}")
                
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
    
    def _get_filename(self, server_name: str) -> str:
        """Формирует имя файла из названия сервера"""
        safe_name = server_name.lower().replace(' ', '-')
        safe_name = ''.join(c for c in safe_name if c.isalnum() or c == '-')
        return f"{safe_name}.json"
    
    def _create_report(self, elapsed_time: float):
        report = {
            "updatedAt": int(datetime.now().timestamp() * 1000),
            "servers_processed": self.servers_processed,
            "total_articles": self.total_articles,
            "errors": self.errors,
            "elapsedTime": round(elapsed_time, 2)
        }
        
        os.makedirs(config.DATA_DIR, exist_ok=True)
        with open(config.REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)


def main():
    os.makedirs(config.DATA_DIR, exist_ok=True)
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()
