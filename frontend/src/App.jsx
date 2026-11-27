import { useEffect, useRef, useState } from "react";
import { createPlayer, startMic } from "./audio";

const BOARDS = [
  { name: "CBSE", available: true },
  { name: "ICSE", available: false },
  { name: "State boards", available: false },
];
const TUTOR_NAME = "Your Science Tutor";
const FRIENDLY_ERROR = "Your tutor hit a small technical challenge. Please try again in a moment.";
const MIC_BLOCKED = "Your microphone is blocked. Please allow mic access in your browser settings, then try again.";

// turn: "tutor" (speaking) | "recording" (mic open, student answering) | "thinking"
const TURN_TITLE = { tutor: "Speaking…", recording: "Listening…" };
const TURN_HINT = {
  tutor: "Mic paused while your tutor speaks.",
  recording: "Take your time. Tap Send when you're done.",
  thinking: "One sec, your tutor is checking your answer.",
};

function MicIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

export default function App() {
  const [missingKeys, setMissingKeys] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [name, setName] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [status, setStatus] = useState("idle"); // idle | active | done
  const [turn, setTurn] = useState("tutor");
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");

  const wsRef = useRef(null);
  const playerRef = useRef(null);
  const micRef = useRef(null);
  const recordingRef = useRef(false);
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((data) => setMissingKeys(data.missing_keys))
      .catch(() => setError(FRIENDLY_ERROR));
    fetch("/api/chapters")
      .then((res) => res.json())
      .then((list) => {
        setChapters(list);
        setChapterId(list[0]?.id ?? "");
      })
      .catch(() => setError(FRIENDLY_ERROR));
    return closeConnections;
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function closeConnections() {
    recordingRef.current = false;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    micRef.current?.stop();
    playerRef.current?.close();
    wsRef.current = micRef.current = playerRef.current = null;
  }

  async function startSession() {
    setError("");
    playerRef.current = createPlayer(); // created inside the click so the browser allows audio
    try {
      micRef.current = await startMic((chunk) => {
        const ws = wsRef.current;
        if (recordingRef.current && ws?.readyState === WebSocket.OPEN) ws.send(chunk);
      });
    } catch {
      closeConnections();
      setError(MIC_BLOCKED);
      return;
    }

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ name: name.trim(), chapter: chapterId });
    const ws = new WebSocket(`${scheme}://${location.host}/api/revision?${params}`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = onServerMessage;
    ws.onclose = (event) => {
      if (!event.wasClean) setError(FRIENDLY_ERROR);
      closeConnections();
      setStatus((current) => (current === "active" ? "idle" : current));
    };
    wsRef.current = ws;

    setMessages([]);
    setTurn("tutor");
    setStatus("active");
  }

  function onServerMessage(event) {
    if (typeof event.data !== "string") {
      playerRef.current?.play(event.data);
      return;
    }
    const message = JSON.parse(event.data);
    if (message.type === "tutor") {
      setTurn("tutor");
      setMessages((prev) => [...prev, { role: "tutor", text: message.text }]);
    } else if (message.type === "student") {
      setMessages((prev) => [...prev, { role: "student", text: message.text }]);
    } else if (message.type === "tutor_done") {
      if (message.final && wsRef.current) wsRef.current.onclose = null; // let the goodbye finish playing
      playerRef.current?.whenFinished(() => {
        if (message.final) {
          closeConnections();
          setStatus("done");
        } else {
          startRecording(); // mic opens on its own once the tutor finishes, like the app
        }
      });
    } else if (message.type === "error") {
      setError(message.text || FRIENDLY_ERROR);
    }
  }

  function startRecording() {
    recordingRef.current = true;
    setTurn("recording");
  }

  function sendAnswer() {
    recordingRef.current = false;
    wsRef.current?.send(JSON.stringify({ type: "send" }));
    setTurn("thinking");
  }

  function endConversation() {
    closeConnections();
    setStatus("idle");
  }

  const active = status === "active";
  const canStart = !!name.trim() && !!chapterId && missingKeys.length === 0 && !active;

  let title = "Voice mode";
  let hint = canStart ? "Tap Start Session when you're ready." : "Enter your name and pick a chapter to begin.";
  if (active) {
    title = TURN_TITLE[turn];
    hint = TURN_HINT[turn];
  } else if (status === "done") {
    title = "Revision complete";
    hint = "Your score is in the transcript. Pick a chapter to revise again.";
  }

  return (
    <main className="solve-page">
      <aside className="solve-sidebar">
        <div className="menu-card">
          <div className="menu-inner">
            <div>
              <h2 className="menu-title">Revision</h2>
              <p className="menu-subtitle">Set up your session.</p>
            </div>

            {missingKeys.length > 0 && (
              <div className="banner banner-warn">
                Key not set: {missingKeys.join(", ")}. Add them to start a voice session.
              </div>
            )}
            {error && <div className="banner banner-error">{error}</div>}
            <div className="banner banner-info">
              Speak in English, Hindi or Hinglish. Your tutor will reply in the same.
            </div>

            <label className="field">
              <span className="field-label">Your name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Priya" disabled={active} />
            </label>

            <label className="field">
              <span className="field-label">Board</span>
              <select className="input" defaultValue="CBSE" disabled={active}>
                {BOARDS.map((board) => (
                  <option key={board.name} value={board.name} disabled={!board.available}>
                    {board.available ? board.name : `${board.name} (coming in the full build)`}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Subject</span>
              <select className="input" disabled>
                <option>Science, Class 10</option>
              </select>
            </label>

            <label className="field">
              <span className="field-label">Chapter</span>
              <select className="input" value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={active}>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                ))}
              </select>
            </label>

            <button type="button" className="button-primary start-session-btn" onClick={startSession} disabled={!canStart}>
              {active ? "Session in progress" : "Start Session"}
            </button>
          </div>
        </div>
      </aside>

      <section className="solve-main">
        <div className="chat-card voice-card">
          <div className="voice-left">
            <div className={`voice-avatar-ring${active && turn === "tutor" ? " voice-avatar-ring--speaking" : ""}`}>
              <img src="/science.png" alt={TUTOR_NAME} className="voice-avatar-img" />
            </div>
            <p className="voice-tutor-name">{TUTOR_NAME}</p>
            <h2 className={`voice-title${active && turn === "thinking" ? " voice-title--thinking" : ""}`}>
              {active && turn === "thinking" ? (
                <>Thinking<span className="voice-dots"><span>.</span><span>.</span><span>.</span></span></>
              ) : title}
            </h2>
            <button
              type="button"
              className={`voice-mic${!active ? " voice-mic--off" : ""}${active && turn === "recording" ? " voice-mic--recording" : ""}`}
              aria-label="Microphone"
              disabled
            >
              <MicIcon />
            </button>
            <p className="voice-hint">{hint}</p>
            {active && turn === "recording" && (
              <button type="button" className="button-primary voice-send-btn" onClick={sendAnswer}>Send</button>
            )}
            {active && (
              <button type="button" className="button-danger voice-end-btn" onClick={endConversation}>End Conversation</button>
            )}
          </div>

          <div className="voice-right">
            <p className="voice-transcript-heading">Transcript</p>
            <div className="voice-transcript">
              {messages.length === 0 ? (
                <p className="voice-transcript-empty">Your conversation will appear here.</p>
              ) : (
                messages.map((message, index) => (
                  <div key={index} className={`voice-bubble voice-bubble--${message.role}`}>
                    <span className="voice-bubble-label">{message.role === "tutor" ? TUTOR_NAME : "You"}</span>
                    <p className="voice-bubble-text">{message.text}</p>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
