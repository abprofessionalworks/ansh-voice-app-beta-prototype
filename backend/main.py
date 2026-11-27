"""Voice revision partner: one WebSocket runs a spoken revision session on a chosen chapter."""

import asyncio
import json
import logging
import os
import time

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR.parent / ".env")  # only this project's .env, never a parent folder's

from tutor import RevisionTutor  # noqa: E402
from voice import speak, transcribe  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("revision")

CHAPTERS_DIR = BASE_DIR / "chapters"
STATIC_DIR = BASE_DIR / "static"  # built frontend, copied in by the Dockerfile
REQUIRED_KEYS = ("OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID")
NOT_HEARD = "Sorry, I didn't catch that. Could you say it again?"
FRIENDLY_ERROR = "Your tutor hit a small technical challenge. Please try again in a moment."


def load_chapters() -> dict[str, dict]:
    """Each chapters/*.md file is one chapter; its first line is the title."""
    chapters = {}
    for path in sorted(CHAPTERS_DIR.glob("*.md")):
        notes = path.read_text(encoding="utf-8")
        title = notes.splitlines()[0].lstrip("#").strip()
        chapters[path.stem] = {"title": title, "notes": notes}
    return chapters


CHAPTERS = load_chapters()
app = FastAPI(title="Voice Revision Partner")


def missing_keys() -> list[str]:
    return [key for key in REQUIRED_KEYS if not os.getenv(key)]


@app.get("/api/status")
def status():
    return {"missing_keys": missing_keys()}


@app.get("/api/chapters")
def chapters():
    return [{"id": chapter_id, "title": chapter["title"]} for chapter_id, chapter in CHAPTERS.items()]


async def say(ws: WebSocket, text: str, final: bool = False) -> None:
    """Send the tutor's text, then stream its audio, then mark the end of the turn."""
    await ws.send_json({"type": "tutor", "text": text})
    started = time.perf_counter()
    async for chunk in speak(text):
        await ws.send_bytes(chunk)
    logger.info("TTS streamed in %.2fs", time.perf_counter() - started)
    await ws.send_json({"type": "tutor_done", "final": final})


async def listen(ws: WebSocket) -> str:
    """Relay the student's mic audio to speech-to-text until they tap Send; return the transcript."""
    audio_chunks: asyncio.Queue = asyncio.Queue()
    stt_task = None
    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))
            if message.get("bytes"):
                if stt_task is None:  # open speech-to-text on the first chunk; the queue holds audio meanwhile
                    stt_task = asyncio.create_task(transcribe(audio_chunks))
                audio_chunks.put_nowait(message["bytes"])
            elif message.get("text") and json.loads(message["text"]).get("type") == "send":
                if stt_task is None:
                    return ""  # Send tapped with no audio
                audio_chunks.put_nowait(None)
                started = time.perf_counter()
                transcript = await stt_task
                logger.info("STT final in %.2fs: %s", time.perf_counter() - started, transcript)
                return transcript
    finally:
        if stt_task and not stt_task.done():
            stt_task.cancel()


@app.websocket("/api/revision")
async def revision(ws: WebSocket, name: str = "", chapter: str = ""):
    await ws.accept()
    if missing := missing_keys():
        await ws.send_json({"type": "error", "text": f"Key not set: {', '.join(missing)}"})
        await ws.close()
        return
    if chapter not in CHAPTERS or not name.strip():
        await ws.send_json({"type": "error", "text": "Please enter your name and pick a chapter."})
        await ws.close()
        return

    logger.info("Session start: name=%s chapter=%s", name, chapter)
    tutor = RevisionTutor(name.strip(), CHAPTERS[chapter]["title"], CHAPTERS[chapter]["notes"])
    try:
        await say(ws, await tutor.opening())
        while not tutor.finished:
            answer = (await listen(ws)).strip()
            if not answer:
                await say(ws, NOT_HEARD)
                continue
            await ws.send_json({"type": "student", "text": answer})
            started = time.perf_counter()
            reply = await tutor.reply(answer)
            logger.info("LLM replied in %.2fs", time.perf_counter() - started)
            await say(ws, reply, final=tutor.finished)
        logger.info("Session complete: name=%s chapter=%s", name, chapter)
        await ws.close()
    except WebSocketDisconnect:
        logger.info("Session closed by student: name=%s", name)
    except Exception:
        logger.exception("Session failed: name=%s chapter=%s", name, chapter)
        try:
            await ws.send_json({"type": "error", "text": FRIENDLY_ERROR})
            await ws.close()
        except Exception:
            pass


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
