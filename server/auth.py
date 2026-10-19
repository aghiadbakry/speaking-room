"""Account gate: register, log in, and read the signed-in user."""

from __future__ import annotations

import hmac
import secrets
from typing import Optional

from fastapi import HTTPException

from server.db import connect, hash_password


def _public(row) -> dict:
    avatar = None
    if row["avatar_skin"] and row["avatar_hair"] and row["avatar_outfit"]:
        avatar = {
            "skin": row["avatar_skin"],
            "hair": row["avatar_hair"],
            "outfit": row["avatar_outfit"],
        }
    complete = bool(row["gender"] and row["age_group"] and avatar and row["mode"])
    return {
        "id": row["id"],
        "username": row["username"],
        "gender": row["gender"],
        "age_group": row["age_group"],
        "avatar": avatar,
        "mode": row["mode"],
        "complete": complete,
    }


def register(path: str, username: str, password: str) -> dict:
    name = username.strip()
    key = name.lower()
    if len(key) < 3 or len(key) > 32:
        raise HTTPException(status_code=400, detail="Use a name of 3 to 32 characters.")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Use a password of at least 8 characters.")
    salt = secrets.token_bytes(16)
    hashed = hash_password(password, salt)
    with connect(path) as conn:
        taken = conn.execute(
            "SELECT 1 FROM accounts WHERE username_key = ?", (key,)
        ).fetchone()
        if taken:
            raise HTTPException(status_code=409, detail="That name is already in use.")
        cur = conn.execute(
            """
            INSERT INTO accounts (username, username_key, password_hash, salt)
            VALUES (?, ?, ?, ?)
            """,
            (name, key, hashed, salt.hex()),
        )
        account_id = cur.lastrowid
        token = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO tokens (token, account_id) VALUES (?, ?)",
            (token, account_id),
        )
        row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    return {"token": token, "user": _public(row)}


def login(path: str, username: str, password: str) -> dict:
    key = username.strip().lower()
    with connect(path) as conn:
        row = conn.execute(
            "SELECT * FROM accounts WHERE username_key = ?", (key,)
        ).fetchone()
        valid = False
        if row is not None:
            salt = bytes.fromhex(row["salt"])
            expected = row["password_hash"]
            actual = hash_password(password, salt)
            valid = hmac.compare_digest(expected, actual)
        if not valid:
            raise HTTPException(
                status_code=401,
                detail="The account is not valid. Check the name and the password.",
            )
        token = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO tokens (token, account_id) VALUES (?, ?)",
            (token, row["id"]),
        )
    return {"token": token, "user": _public(row)}


def user_from_token(path: str, token: Optional[str]) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Log in to continue.")
    with connect(path) as conn:
        row = conn.execute(
            """
            SELECT accounts.* FROM tokens
            JOIN accounts ON accounts.id = tokens.account_id
            WHERE tokens.token = ?
            """,
            (token,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Log in to continue.")
    return _public(row)


def logout(path: str, token: str) -> None:
    with connect(path) as conn:
        conn.execute("DELETE FROM tokens WHERE token = ?", (token,))
