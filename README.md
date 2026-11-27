# Voice Revision Partner

A voice-first revision and doubts solving partner for Indian school students. Pick a chapter, and the tutor quizzes you out loud, just like how your friend does befone an exam (but with the expertise of a teacher now added). Answer by speaking (English, Hindi or Hinglish), tap **Send**, and get instant spoken feedback. After roughly 5 questions (limited for protype purposes) you get a score and the topics to revisit.

Prototype scope: CBSE, Class 10 Science, 2 chapters.

## Run

```bash
docker compose up --build
```

Open http://localhost:8000.

Please ensure the port used above is free on your machine.

The app starts and shows its main screen **without any keys**. To run a voice session, copy `.env.example` to `.env` and fill in:

Without the below keys the app still loads and displays, but will display a message along the lines of “key not set” (as asked in competition instructions)

The voice AI tutor needs the following keys to do the revision:
| Key | What it's for |
|---|---|
| `OPENAI_API_KEY` | The tutor's questions and feedback (gpt-5.4-mini) |
| `ELEVENLABS_API_KEY` | Speech-to-text (Scribe v2 Realtime) and text-to-speech (Flash v2.5) |
| `ELEVENLABS_VOICE_ID` | The tutor's voice |

## How it works

```

User speaks ──▶ Realtime STT ──▶ AI Tutor (LLM) ──▶ Realtime STT ──▶ User hears back

```

## Local development (without Docker)

```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --reload
cd frontend && npm install && npm run dev   # http://localhost:5173
```
