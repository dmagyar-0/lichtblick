# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0

"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os


class Config:
    host: str
    port: int
    cors_origins: list[str]

    def __init__(self) -> None:
        self.host = os.environ.get("LICHTBLICK_HOST", "0.0.0.0")
        self.port = int(os.environ.get("LICHTBLICK_PORT", "8000"))
        origins = os.environ.get("LICHTBLICK_CORS_ORIGINS", "*")
        self.cors_origins = [o.strip() for o in origins.split(",")]


config = Config()
