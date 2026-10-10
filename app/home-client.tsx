"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function makeRoomId() {
  return Math.random().toString(36).slice(2, 7) + "-" + Math.random().toString(36).slice(2, 7);
}

function extractRoom(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/room\/([^/]+)/);
    return decodeURIComponent(match?.[1] || "");
  } catch {
    return decodeURIComponent(raw.replace(/^\/room\//, "").replace(/^.*\/room\//, ""));
  }
}

export default function HomeClient() {
  const router = useRouter();
  const [room, setRoom] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  function createRoom() {
    router.push(`/room/${makeRoomId()}`);
  }

  async function joinRoom() {
    if (checking) return;

    const id = extractRoom(room);
    if (!id) {
      setError("Введите ID или ссылку комнаты.");
      return;
    }

    setChecking(true);
    setError("");

    try {
      const response = await fetch(`/api/room-exists?room=${encodeURIComponent(id)}`, {
        cache: "no-store"
      });
      const data = await response.json();

      if (!response.ok || !data.exists) {
        setError("Такой активной комнаты сейчас нет. Попросите организатора открыть встречу.");
        return;
      }

      router.push(`/room/${encodeURIComponent(id)}`);
    } catch {
      setError("Не удалось проверить комнату. Попробуйте ещё раз.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="page">
      <header className="page-head">
        <span className="wordmark">MeetSpace</span>
      </header>

      <div className="page-main">
        <section className="intro">
          <h1>Видеозвонки в браузере</h1>
          <p>Создайте встречу и отправьте ссылку. Регистрация не нужна.</p>

          <div className="start">
            <button className="btn btn-dark" onClick={createRoom}>Новая встреча</button>

            <div className={`code-field ${error ? "invalid" : ""}`}>
              <input
                value={room}
                onChange={(e) => {
                  setRoom(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                placeholder="Код или ссылка на встречу"
                aria-label="Код или ссылка на встречу"
                aria-invalid={!!error}
                disabled={checking}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <button className="btn-text" onClick={joinRoom} disabled={checking || !room.trim()}>
                {checking ? "Проверяем…" : "Войти"}
              </button>
            </div>
          </div>

          {error && <p className="msg-error" role="alert">{error}</p>}
        </section>
      </div>

      <footer className="page-foot">MeetSpace</footer>
    </main>
  );
}
