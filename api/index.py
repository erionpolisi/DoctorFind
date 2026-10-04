"""Vercel serverless entry point — exposes the FastAPI gateway + dashboard + patient web app."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from app import app  # noqa: E402,F401  (Vercel detects the ASGI `app`)
