"""Local FastAPI server for the public-speaking simulation.

This first step is the account gate: register, log in, avatar, mode, and the
three level cards. Speech and the 3D room are the following steps.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server.auth import _public, login, logout, register, user_from_token
from server.db import connect, init_db
from server.levels import levels_for
from server.practice import finish_session, start_session, take_turn
from server.speech import speak_line

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "client"
DEFAULT_DB = ROOT / "data" / "app.sqlite"

Gender = Literal["female", "male"]
AgeGroup = Literal["under_18", "18_plus"]
Skin = Literal["light", "medium", "deep"]
Hair = Literal["short", "tied", "long"]
Outfit = Literal["navy", "white", "black"]
Mode = Literal["normal", "vr"]


class Credentials(BaseModel):
    username: str
    password: str


class AvatarIn(BaseModel):
    skin: Skin
    hair: Hair
    outfit: Outfit


class StartIn(BaseModel):
    level: int


class SayIn(BaseModel):
    line: str
    role: str = ""


class ProfileIn(BaseModel):
    gender: Optional[Gender] = None
    age_group: Optional[AgeGroup] = None
    avatar: Optional[AvatarIn] = None
    mode: Optional[Mode] = None


def create_app(db_path: str) -> FastAPI:
    app = FastAPI(title="Public speaking simulation")
    app.state.db_path = db_path
    init_db(db_path)

    def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        return user_from_token(app.state.db_path, token)

    def current_token(authorization: Optional[str] = Header(default=None)) -> str:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Log in to continue.")
        return authorization[7:].strip()

    @app.post("/api/register")
    def register_account(body: Credentials):
        return register(app.state.db_path, body.username, body.password)

    @app.post("/api/login")
    def login_account(body: Credentials):
        return login(app.state.db_path, body.username, body.password)

    @app.post("/api/logout")
    def logout_account(token: str = Depends(current_token)):
        logout(app.state.db_path, token)
        return {"ok": True}

    @app.get("/api/me")
    def me(user: dict = Depends(current_user)):
        return user

    @app.put("/api/profile")
    def update_profile(body: ProfileIn, user: dict = Depends(current_user)):
        fields = []
        values = []
        if body.gender is not None:
            fields.append("gender = ?")
            values.append(body.gender)
        if body.age_group is not None:
            fields.append("age_group = ?")
            values.append(body.age_group)
        if body.avatar is not None:
            fields.extend(["avatar_skin = ?", "avatar_hair = ?", "avatar_outfit = ?"])
            values.extend([body.avatar.skin, body.avatar.hair, body.avatar.outfit])
        if body.mode is not None:
            fields.append("mode = ?")
            values.append(body.mode)
        if not fields:
            raise HTTPException(status_code=400, detail="Nothing to save.")
        values.append(user["id"])
        with connect(app.state.db_path) as conn:
            conn.execute(
                f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            row = conn.execute(
                "SELECT * FROM accounts WHERE id = ?", (user["id"],)
            ).fetchone()
        return _public(row)

    @app.get("/api/levels")
    def levels(user: dict = Depends(current_user)):
        if not user["age_group"]:
            raise HTTPException(status_code=400, detail="Set an age group first.")
        return {"age_group": user["age_group"], "levels": levels_for(user["age_group"])}

    @app.post("/api/sessions")
    def open_session(body: StartIn, user: dict = Depends(current_user)):
        payload, error = start_session(app.state.db_path, user, body.level)
        if error:
            raise HTTPException(status_code=400, detail=error)
        return payload

    @app.post("/api/sessions/{session_id}/turn")
    async def session_turn(
        session_id: int, request: Request, user: dict = Depends(current_user)
    ):
        pcm = await request.body()
        sample_rate = int(request.headers.get("x-sample-rate", "16000"))
        payload, error = take_turn(
            app.state.db_path, user, session_id, pcm, sample_rate
        )
        if error:
            raise HTTPException(status_code=404, detail=error)
        return payload

    @app.post("/api/say")
    def say_line(body: SayIn, user: dict = Depends(current_user)):
        audio = speak_line(body.line, body.role)
        status = str(getattr(speak_line, "last_status", 0))
        reason = str(getattr(speak_line, "last_reason", ""))
        headers = {"X-Voice-Status": status, "X-Voice-Reason": reason}
        if not audio:
            return Response(status_code=204, headers=headers)
        return Response(content=audio, media_type="audio/wav", headers=headers)

    @app.post("/api/sessions/{session_id}/finish")
    def close_session(session_id: int, user: dict = Depends(current_user)):
        payload, error = finish_session(app.state.db_path, user, session_id)
        if error:
            raise HTTPException(status_code=404, detail=error)
        return payload

    @app.get("/")
    def index():
        return FileResponse(CLIENT / "index.html")

    app.mount("/static", StaticFiles(directory=CLIENT), name="static")
    return app


app = create_app(os.environ.get("SIM_DB", str(DEFAULT_DB)))
