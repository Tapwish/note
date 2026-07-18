# utils/logger.py

import logging
import sys
from typing import Optional


class Logger:
    """Универсальный логгер для парсера"""
    
    _instance: Optional['Logger'] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._setup_logger()
        return cls._instance
    
    def _setup_logger(self):
        """Настройка логгера"""
        self.logger = logging.getLogger("MajesticParser")
        self.logger.setLevel(logging.INFO)
        
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        
        formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s',
            datefmt='%H:%M:%S'
        )
        console_handler.setFormatter(formatter)
        
        if self.logger.handlers:
            self.logger.handlers.clear()
        
        self.logger.addHandler(console_handler)
    
    def info(self, message: str):
        self.logger.info(message)
    
    def success(self, message: str):
        self.logger.info(f"✅ {message}")
    
    def warning(self, message: str):
        self.logger.warning(f"⚠️ {message}")
    
    def error(self, message: str):
        self.logger.error(f"❌ {message}")
    
    def debug(self, message: str):
        self.logger.debug(message)


logger = Logger()