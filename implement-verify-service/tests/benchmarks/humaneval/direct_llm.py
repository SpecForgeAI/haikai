"""
Direct LLM client for HumanEval benchmarks.

Bypasses the Standards Extractor API and calls LLM providers directly.
Used when the API isn't available or for establishing raw LLM baselines
independent of the application pipeline.

Supports:
  - Anthropic (Claude) via the anthropic SDK
  - OpenAI (GPT) via the openai SDK
"""

import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass 
class DirectLLMResponse:
    """Response from a direct LLM call."""
    success: bool
    content: str = ""
    error: Optional[str] = None
    latency_seconds: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""


class DirectLLMClient:
    """Direct LLM client that talks to providers without the SE API."""

    def __init__(self, model_name: str, provider: str):
        self.model_name = model_name
        self.provider = provider
        self._anthropic_client = None
        self._openai_client = None

    def generate(self, prompt: str, system: str = "") -> DirectLLMResponse:
        """Generate a completion from the LLM."""
        if self.provider == "anthropic":
            return self._call_anthropic(prompt, system)
        elif self.provider == "openai":
            return self._call_openai(prompt, system)
        else:
            return DirectLLMResponse(
                success=False,
                error=f"Unknown provider: {self.provider}",
            )

    def _call_anthropic(self, prompt: str, system: str = "") -> DirectLLMResponse:
        """Call Anthropic Claude API directly."""
        try:
            import anthropic
        except ImportError:
            return DirectLLMResponse(
                success=False,
                error="anthropic package not installed. Run: pip install anthropic",
            )

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return DirectLLMResponse(success=False, error="ANTHROPIC_API_KEY not set")

        if self._anthropic_client is None:
            self._anthropic_client = anthropic.Anthropic(api_key=api_key)

        start = time.monotonic()
        try:
            kwargs = {
                "model": self.model_name,
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": prompt}],
            }
            if system:
                kwargs["system"] = system

            response = self._anthropic_client.messages.create(**kwargs)
            latency = time.monotonic() - start

            content = ""
            for block in response.content:
                if hasattr(block, "text"):
                    content += block.text

            return DirectLLMResponse(
                success=True,
                content=content,
                latency_seconds=latency,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                model=response.model,
            )
        except Exception as e:
            return DirectLLMResponse(
                success=False,
                error=str(e),
                latency_seconds=time.monotonic() - start,
            )

    def _call_openai(self, prompt: str, system: str = "") -> DirectLLMResponse:
        """Call OpenAI API directly."""
        try:
            import openai
        except ImportError:
            return DirectLLMResponse(
                success=False,
                error="openai package not installed. Run: pip install openai",
            )

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return DirectLLMResponse(success=False, error="OPENAI_API_KEY not set")

        if self._openai_client is None:
            self._openai_client = openai.OpenAI(api_key=api_key)

        start = time.monotonic()
        try:
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            response = self._openai_client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                max_tokens=2048,
                temperature=0.0,
            )
            latency = time.monotonic() - start

            content = response.choices[0].message.content or ""

            return DirectLLMResponse(
                success=True,
                content=content,
                latency_seconds=latency,
                input_tokens=response.usage.prompt_tokens if response.usage else 0,
                output_tokens=response.usage.completion_tokens if response.usage else 0,
                model=response.model,
            )
        except Exception as e:
            return DirectLLMResponse(
                success=False,
                error=str(e),
                latency_seconds=time.monotonic() - start,
            )

    def close(self):
        """Clean up clients."""
        self._anthropic_client = None
        self._openai_client = None
