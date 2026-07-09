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
        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        self.forum_parser = ForumParser(self.driver)
        self.codex_parser = CodexParser(self.driver)
        
        self.total_articles = 0
        self.servers_processed = 0
        self.errors = []
    
    def run(self):
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser")
            start_time = time.time()
            
            # ============================================================
            # СОЗДАЁМ ПАПКУ
            # ============================================================
            os.makedirs(config.DATA_DIR, exist_ok=True)
            
            # ============================================================
            # ПАРСИМ КАЖДЫЙ СЕРВЕР
            # ============================================================
            for server in config.SERVERS:
                self._process_server(server)
                time.sleep(1)
            
            # ============================================================
            # ОТЧЁТ
            # ============================================================
            elapsed_time = time.time() - start_time
            logger.success(f"✅ Готово за {elapsed_time:.2f} сек")
            logger.success(f"✅ Серверов: {self.servers_processed}, статей: {self.total_articles}")
            
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
            # ============================================================
            # ИЩЕМ КОДЕКСЫ
            # ============================================================
            codex_links = self.forum_parser.find_codexes_in_section(section_url)
            
            if not codex_links:
                logger.warning(f"⚠️ Кодексы не найдены для {server_name}")
                return
            
            # ============================================================
            # ПАРСИМ КАЖДЫЙ КОДЕКС
            # ============================================================
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
            
            # ============================================================
            # СОХРАНЯЕМ JSON
            # ============================================================
            if server_articles > 0:
                filename = self._get_filename(server_name)
                filepath = os.path.join(config.DATA_DIR, filename)
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(server_laws.to_dict(), f, ensure_ascii=False, indent=2)
                
                self.servers_processed += 1
                logger.success(f"✅ {server_name}: {server_articles} статей -> {filename}")
            else:
                logger.warning(f"⚠️ {server_name}: 0 статей, файл не сохранён")
                
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
            self.errors.append(f"{server_name}: {str(e)}")
    
    def _get_filename(self, server_name: str) -> str:
        safe_name = server_name.lower().replace(' ', '-')
        safe_name = ''.join(c for c in safe_name if c.isalnum() or c == '-')
        return f"{safe_name}.json"


def main():
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()
