"""SQLite storage. Passwords are salted hashes, never clear text."""

import hashlib
import sqlite3
from pathlib import Path

ITERATIONS = 120_000


def connect(path: str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: str) -> None:
    with connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                username_key TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                gender TEXT,
                age_group TEXT,
                avatar_skin TEXT,
                avatar_hair TEXT,
                avatar_outfit TEXT,
                mode TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS tokens (
                token TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                level INTEGER NOT NULL,
                mode TEXT,
                pace REAL,
                pauses REAL,
                repetition REAL,
                clarity REAL,
                organization REAL,
                confidence REAL,
                stress REAL,
                weak_skill TEXT,
                next_level INTEGER,
                finished_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES sessions(id),
                transcript TEXT,
                pace REAL,
                pauses REAL,
                repeated REAL,
                clarity REAL,
                stress REAL,
                confidence REAL,
                scored INTEGER NOT NULL DEFAULT 0,
                role TEXT,
                line TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )
        columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
        for name, kind in (
            ("stress", "REAL"),
            ("weak_skill", "TEXT"),
            ("next_level", "INTEGER"),
            ("finished_at", "TEXT"),
        ):
            if name not in columns:
                conn.execute("ALTER TABLE sessions ADD COLUMN %s %s" % (name, kind))


def hash_password(password: str, salt: bytes) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return digest.hex()
