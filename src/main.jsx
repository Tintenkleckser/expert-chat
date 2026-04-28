import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, ExternalLink, LogOut, MessageSquare, Mic, Plus, Send } from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CHAT_STREAM_URL =
  import.meta.env.VITE_CHAT_STREAM_URL ||
  (API_BASE ? `${API_BASE}/api/chat/stream` : `${SUPABASE_URL}/functions/v1/expert-chat-stream`);
const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const starters = [
  "Erstellen Sie einen Beobachtungsbogen",
  "Wie lassen sich der DIK 2 und das Handbuch für die Berufseignung nutzen?",
  "Erstellen Sie ein Programm für eine Arbeitserprobung mit einer Dauer von 4 Wochen im Berufsfeld Gastronomie."
];

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const loadChats = useCallback(async () => {
    if (!session) return;
    const { data, error: chatsError } = await supabase
      .from("expert_chats")
      .select("id, last_message, created_at, updated_at")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false });

    if (!chatsError) setChats(data || []);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    loadChats();
  }, [session, loadChats]);

  async function openChat(chatId) {
    const { data, error: messagesError } = await supabase
      .from("expert_messages")
      .select("role, content, created_at")
      .eq("chat_id", chatId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      setError(messagesError.message);
      return;
    }

    setActiveChatId(chatId);
    setMessages((data || []).map((message) => ({ role: message.role, content: message.content })));
  }

  async function createChat(firstMessage) {
    const { data, error: chatError } = await supabase
      .from("expert_chats")
      .insert({
        user_id: session.user.id,
        last_message: firstMessage
      })
      .select("id")
      .single();

    if (chatError) throw chatError;
    setActiveChatId(data.id);
    await loadChats();
    return data.id;
  }

  async function saveMessage({ chatId, role, content }) {
    const { error: messageError } = await supabase.from("expert_messages").insert({
      chat_id: chatId,
      user_id: session.user.id,
      role,
      content
    });

    if (messageError) throw messageError;

    await supabase
      .from("expert_chats")
      .update({
        last_message: content.slice(0, 180),
        updated_at: new Date().toISOString()
      })
      .eq("id", chatId)
      .eq("user_id", session.user.id);
  }

  async function submitQuestion(questionText = input) {
    const question = questionText.trim();
    if (!question || loading) return;

    setError("");
    setInput("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: question }]);

    const assistantMessage = {
      role: "assistant",
      content: "",
      contexts: [],
      diagnostics: [],
      streaming: true,
      status: "Quellen werden geprüft ..."
    };

    setMessages((current) => [...current, assistantMessage]);

    try {
      let streamedAnswer = "";
      const chatId = activeChatId || (await createChat(question));
      await saveMessage({ chatId, role: "user", content: question });

      const response = await fetch(CHAT_STREAM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ question })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Die Anfrage ist fehlgeschlagen.");
      }

      await readEventStream(response, {
        onMeta: (payload) => {
          setMessages((current) =>
            updateLastAssistant(current, {
              ...payload,
              status: "Antwort wird vorbereitet ..."
            })
          );
        },
        onToken: (token) => {
          streamedAnswer += token;
          setMessages((current) =>
            updateLastAssistant(current, (message) => ({
              ...message,
              content: `${message.content}${token}`,
              status: ""
            }))
          );
        },
        onError: (message) => {
          throw new Error(message);
        }
      });

      if (streamedAnswer) {
        await saveMessage({ chatId, role: "assistant", content: streamedAnswer });
        await loadChats();
      }
    } catch (requestError) {
      setError(requestError.message);
      setMessages((current) => current.filter((message) => !message.streaming));
    } finally {
      setLoading(false);
      setMessages((current) =>
        updateLastAssistant(current, (message) => ({ ...message, streaming: false, status: "" }))
      );
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setMessages([]);
    setChats([]);
    setActiveChatId(null);
  }

  if (authLoading) {
    return <div className="auth-loading">Lade ...</div>;
  }

  if (!session) {
    return <AuthScreen onAuth={(newSession) => setSession(newSession)} />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo-mark">
            <img src="/synapse-logo.png" alt="" />
          </span>
          <strong>Expert Chat</strong>
        </div>

        <button
          className="new-chat"
          onClick={() => {
            setMessages([]);
            setActiveChatId(null);
          }}
        >
          <Plus size={18} />
          Neuer Chat
        </button>

        <nav className="history" aria-label="Chatverlauf">
          {chats.map((chat) => (
            <button
              className={`history-item ${chat.id === activeChatId ? "active" : ""}`}
              key={chat.id}
              onClick={() => openChat(chat.id)}
            >
              <MessageSquare size={16} />
              <span>{chat.last_message || "Neuer Chat"}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <a
            className="footer-link"
            href="https://handbuchprojekt-e5524.web.app"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} />
            Handbuch öffnen
          </a>
          <button className="account-row" onClick={signOut}>
            <span>{session.user.email}</span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <section className="chat-area">
        {messages.length === 0 ? (
          <Welcome onStarter={submitQuestion} />
        ) : (
          <Conversation messages={messages} />
        )}

        <div className="composer-wrap">
          {error && <p className="error-text">{error}</p>}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitQuestion();
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ihre Frage ..."
              aria-label="Frage"
            />
            <button className="icon-button ghost" type="button" aria-label="Spracheingabe">
              <Mic size={18} />
            </button>
            <button className="send-button" type="submit" aria-label="Senden" disabled={loading}>
              <Send size={18} />
            </button>
          </form>

        </div>
      </section>
    </main>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitAuth(event) {
    event.preventDefault();
    setMessage("");

    if (!supabase) {
      setMessage("VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen in der .env.");
      return;
    }

    setSubmitting(true);
    try {
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) throw result.error;

      if (result.data.session) {
        onAuth(result.data.session);
      } else {
        setMessage("Registrierung erfolgreich. Bitte bestätigen Sie Ihre E-Mail, falls Supabase das verlangt.");
      }
    } catch (authError) {
      setMessage(authError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <span className="logo-mark">
            <img src="/synapse-logo.png" alt="" />
          </span>
          <strong>Expert Chat</strong>
        </div>

        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Login
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={submitAuth}>
          <label>
            E-Mail
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Passwort
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </label>
          {message && <p className="auth-message">{message}</p>}
          <button className="auth-submit" disabled={submitting}>
            {mode === "login" ? "Einloggen" : "Registrieren"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Welcome({ onStarter }) {
  return (
    <div className="welcome">
      <div className="welcome-icon">
        <img src="/synapse-logo.png" alt="" />
      </div>
      <h1>Was kann ich heute für Sie tun?</h1>
      <div className="starter-grid">
        {starters.map((starter) => (
          <button key={starter} onClick={() => onStarter(starter)}>
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}

function Conversation({ messages }) {
  return (
    <div className="conversation">
      {messages.map((message, index) => (
        <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
          <div className="message-avatar">
            {message.role === "assistant" ? (
              <img src="/synapse-logo.png" alt="" />
            ) : (
              <MessageSquare size={18} />
            )}
          </div>
          <div className="message-body">
            {message.role === "assistant" && message.content && !message.streaming && (
              <button
                className="save-answer-button"
                type="button"
                onClick={() => downloadAnswer(message.content, index)}
                aria-label="Antwort speichern"
                title="Antwort speichern"
              >
                <Download size={15} />
              </button>
            )}
            {message.content ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            ) : (
              message.status && <LoadingIndicator label={message.status} />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function LoadingIndicator({ label }) {
  return (
    <div className="loading-indicator" aria-live="polite">
      <span />
      <span />
      <span />
      <strong>{label}</strong>
    </div>
  );
}

async function readEventStream(response, handlers) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventText of events) {
      const event = parseSseEvent(eventText);
      if (!event) continue;

      if (event.name === "meta") handlers.onMeta(event.data);
      if (event.name === "token") handlers.onToken(event.data.token);
      if (event.name === "error") handlers.onError(event.data.error);
    }
  }
}

function parseSseEvent(eventText) {
  const lines = eventText.split("\n");
  const name = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
  if (!name || !data) return null;
  return { name, data: JSON.parse(data) };
}

function updateLastAssistant(messages, patch) {
  const next = [...messages];
  const index = next.findLastIndex((message) => message.role === "assistant");
  if (index === -1) return messages;
  next[index] = typeof patch === "function" ? patch(next[index]) : { ...next[index], ...patch };
  return next;
}

function downloadAnswer(content, index) {
  const date = new Date().toISOString().slice(0, 10);
  const file = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `expert-chat-antwort-${date}-${index + 1}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

createRoot(document.getElementById("root")).render(<App />);
