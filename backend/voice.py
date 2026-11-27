"""ElevenLabs speech-to-text (realtime, manual commit) and text-to-speech (streamed PCM)."""

import asyncio
import base64
import logging
import os

from collections.abc import AsyncIterator

from elevenlabs import AsyncElevenLabs, VoiceSettings
from elevenlabs.realtime import AudioFormat, CommitStrategy, RealtimeEvents

logger = logging.getLogger(__name__)

STT_MODEL = "scribe_v2_realtime"
TTS_MODEL = "eleven_flash_v2_5"
STT_LANGUAGE = None
TTS_OUTPUT_FORMAT = "pcm_24000"  # 16-bit mono PCM at 24 kHz, played directly by the browser
TRANSCRIPT_TIMEOUT_S = 10
STT_SECONDARY_LANGUAGES = ["hi"]  # Hindi/Hinglish may also be spoken

TTS_VOICE_SETTINGS = VoiceSettings(
    speed=1.1,
    style=0.1,
    stability=0.8,
    similarity_boost=0.75,
    use_speaker_boost=True,
)

STT_ERROR_EVENTS = (
    RealtimeEvents.ERROR,
    RealtimeEvents.AUTH_ERROR,
    RealtimeEvents.QUOTA_EXCEEDED,
    RealtimeEvents.TRANSCRIBER_ERROR,
)


def _client() -> AsyncElevenLabs:
    return AsyncElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))


async def transcribe(audio_chunks: asyncio.Queue) -> str:
    """Stream PCM 16 kHz chunks from the queue until None, then commit and return the transcript."""
    conn = await _client().speech_to_text.realtime.connect({
        "model_id": STT_MODEL,
        "audio_format": AudioFormat.PCM_16000,
        "sample_rate": 16000,
        "commit_strategy": CommitStrategy.MANUAL,
        "language_code": STT_LANGUAGE,
        "include_timestamps": True,
        "secondary_languages": STT_SECONDARY_LANGUAGES,
    })
    transcript = asyncio.get_running_loop().create_future()

    def on_committed(data):
        if not transcript.done():
            transcript.set_result(data.get("text", ""))

    def on_error(data):
        logger.error("STT error: %s", data)
        if not transcript.done():
            transcript.set_exception(RuntimeError(f"STT error: {data}"))

    conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, on_committed)
    for event in STT_ERROR_EVENTS:
        conn.on(event, on_error)

    try:
        while (chunk := await audio_chunks.get()) is not None:
            await conn.send({"audio_base_64": base64.b64encode(chunk).decode()})
        await conn.commit()
        return await asyncio.wait_for(transcript, TRANSCRIPT_TIMEOUT_S)
    finally:
        try:
            await conn.close()
        except Exception:
            pass


async def speak(text: str) -> AsyncIterator[bytes]:
    """Yield the spoken text as PCM chunks, each an even number of bytes (whole 16-bit samples)."""
    leftover = b""
    async for chunk in _client().text_to_speech.stream(
        os.getenv("ELEVENLABS_VOICE_ID"),
        text=text,
        model_id=TTS_MODEL,
        output_format=TTS_OUTPUT_FORMAT,
        voice_settings=TTS_VOICE_SETTINGS,
    ):
        chunk = leftover + chunk
        whole = len(chunk) - len(chunk) % 2
        leftover = chunk[whole:]
        if whole:
            yield chunk[:whole]