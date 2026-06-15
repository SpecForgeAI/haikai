"""
Module for fetching architectural metamodels from REST endpoints.
"""
import os
import json
import logging
import requests
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class MetamodelGateway:
    """
    Gateway for fetching architectural metamodels from external systems.
    
    Responsibilities:
    - Fetch metamodel data from REST endpoint
    - Load metamodel data from local file
    - Persist metamodel to specified directory
    """
    
    def __init__(self, output_dir: Path):
        """
        Initialize the gateway.
        
        Args:
            output_dir: Base directory for metamodel output
        """
        self.output_dir = Path(output_dir)
        self.metamodel_dir = self.output_dir / 'metamodel'
        
        # REST Endpoint configuration from environment
        self.endpoint_url = os.getenv('METAMODEL_ENDPOINT_URL')
        self.api_key = os.getenv('METAMODEL_API_KEY')
        self.auth_token = os.getenv('METAMODEL_AUTH_TOKEN')
    
    def get_from_endpoint(self, metamodel_id: str) -> Dict:
        """
        Fetch metamodel data from the configured REST endpoint.
        
        Args:
            metamodel_id: Project/metamodel identifier
            
        Returns:
            Metamodel data as dictionary
            
        Raises:
            ValueError: If endpoint URL not configured
            requests.RequestException: If fetch fails
        """
        if not self.endpoint_url:
            raise ValueError("METAMODEL_ENDPOINT_URL not set in environment")
        
        url = f"{self.endpoint_url.rstrip('/')}/{metamodel_id}"
        headers = {}
        
        if self.api_key:
            headers['X-API-Key'] = self.api_key
        if self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        
        logger.info(f"Fetching metamodel from: {url}")
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        
        return response.json()
    
    def load_from_file(self, file_path: Path) -> Dict:
        """
        Load metamodel data from a local JSON file.
        
        Args:
            file_path: Path to local metamodel file
            
        Returns:
            Metamodel data as dictionary
            
        Raises:
            FileNotFoundError: If file doesn't exist
            json.JSONDecodeError: If file is not valid JSON
        """
        logger.info(f"Loading metamodel from file: {file_path}")
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def persist(self, data: Dict) -> Path:
        """
        Persist metamodel data to local directory.
        
        Args:
            data: Metamodel data to persist
            
        Returns:
            Path to persisted architecture.json
        """
        self.metamodel_dir.mkdir(parents=True, exist_ok=True)
        target_path = self.metamodel_dir / 'architecture.json'
        
        with open(target_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        
        logger.info(f"Metamodel persisted to: {target_path}")
        return target_path
    
    def get_and_persist(self, metamodel_id: str) -> Path:
        """
        Convenience method: fetch from endpoint and persist in one call.
        
        Args:
            metamodel_id: Project/metamodel identifier
            
        Returns:
            Path to persisted architecture.json
        """
        data = self.get_from_endpoint(metamodel_id)
        return self.persist(data)
