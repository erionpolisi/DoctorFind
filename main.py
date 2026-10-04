"""Vercel entrypoint — loads the FastAPI gateway from server/app.py.

Lives at the repo root (NOT in api/: that folder is Vercel's classic-functions
convention and would shadow /api/* routes away from this service). The import
goes by file path under a unique module name so the app/ directory (the Expo
project, a namespace package) can never shadow server/app.py.
"""
import importlib.util
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent / "server"
sys.path.insert(0, str(SERVER))  # for server-internal imports (hashing, routing)

_spec = importlib.util.spec_from_file_location("gateway_app", SERVER / "app.py")
_mod = importlib.util.module_from_spec(_spec)
sys.modules["gateway_app"] = _mod
_spec.loader.exec_module(_mod)

app = _mod.app
