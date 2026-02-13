# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

"""
FastAPI application entry point for the Lichtblick backend service.

Run with:
    uv run python -m lichtblick_backend.main
"""

from __future__ import annotations

import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import config
from .demo_source import DemoDataSource
from .router import register_source, router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title="Lichtblick Backend",
    description="Message-level API backend for Lichtblick visualization.",
    version="0.1.0",
)

# CORS middleware — allow configurable origins (default: all)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Register the demo data source
register_source("demo", DemoDataSource())


def main() -> None:
    """Run the server via uvicorn."""
    uvicorn.run(
        "lichtblick_backend.main:app",
        host=config.host,
        port=config.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
