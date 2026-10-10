"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export type Facing = "user" | "environment";

type Props = {
  roomName: string;
  name: string;
  onName: (v: string) => void;
  mic: boolean;
  onMic: (v: boolean) => void;
  cam: boolean;
  onCam: (v: boolean) => void;
  facing: Facing;
  onFacing: (f: Facing) => void;
  flipFix: boolean;
  touch: boolean;
  joining: boolean;
  error: string;
  onJoin: () => void;
};

/** Экран входа: имя + предпросмотр камеры + включение/выключение микрофона и камеры. */
export function Lobby(p: Props) {
  const { cam, facing, joining, onCam } = p;
  const videoRef = useRef<HTMLVideoElement>(null);
  // Предпросмотр показывает ровно то, что увидят остальные: у передней камеры — с исправлением зеркала.
  const flipFixRef = useRef(p.flipFix);
  const facingRef = useRef(p.facing);
  useEffect(() => {
    flipFixRef.current = p.flipFix;
    facingRef.current = p.facing;
    if (videoRef.current) videoRef.current.style.transform = p.flipFix && p.facing === "user" ? "scaleX(-1)" : "none";
  }, [p.flipFix, p.facing]);
  const [live, setLive] = useState(false);
  const [camError, setCamError] = useState("");
  const [camCount, setCamCount] = useState(0);

  // Предпросмотр. Пока идёт вход (joining) камеру отпускаем, чтобы её смог взять LiveKit.
  useEffect(() => {
    if (!cam || joining) return;
    let stream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          el.style.transform = flipFixRef.current && facingRef.current === "user" ? "scaleX(-1)" : "none"; // приложение не зеркалит; флаг — только исправление «зеркальной» камеры
          el.play().catch(() => {});
        }
        setCamError("");
        setLive(true);
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCamCount(list.filter((d) => d.kind === "videoinput").length);
      } catch {
        if (cancelled) return;
        setLive(false);
        setCamError("Нет доступа к камере. Разрешите её в настройках браузера или войдите без видео.");
        onCam(false);
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setLive(false);
    };
  }, [cam, facing, joining, onCam]);

  const canFlip = p.touch && cam && live && camCount > 1;

  return (
    <main className="page">
      <header className="page-head">
        <a className="wordmark" href="/">MeetSpace</a>
      </header>

      <div className="lobby">
        <div className="preview">
          <video ref={videoRef} autoPlay playsInline muted style={{ display: cam && live ? "block" : "none" }} />
          {!(cam && live) && (
            <div className="preview-off">
              {camError || (cam ? "Запускаем камеру…" : "Камера выключена")}
            </div>
          )}
          <div className="preview-ctrl">
            <button
              className={`pv-btn ${p.mic ? "" : "off"}`}
              onClick={() => p.onMic(!p.mic)}
              title={p.mic ? "Выключить микрофон" : "Включить микрофон"}
              aria-pressed={p.mic}
            >
              <Icon name={p.mic ? "mic" : "micOff"} />
            </button>
            <button
              className={`pv-btn ${cam ? "" : "off"}`}
              onClick={() => { setCamError(""); onCam(!cam); }}
              title={cam ? "Выключить камеру" : "Включить камеру"}
              aria-pressed={cam}
            >
              <Icon name={cam ? "video" : "videoOff"} />
            </button>
            {canFlip && (
              <button className="pv-btn" onClick={() => p.onFacing(facing === "user" ? "environment" : "user")} title="Переключить камеру" aria-label="Переключить камеру">
                <Icon name="flip" />
              </button>
            )}
          </div>
        </div>

        <div className="lobby-form">
          <h2>Готовы войти?</h2>
          <p className="muted">Встреча: {p.roomName}</p>

          <label htmlFor="display-name">Ваше имя</label>
          <input
            id="display-name"
            className="text-input"
            value={p.name}
            onChange={(e) => p.onName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && p.onJoin()}
            placeholder="Как вас называть"
            disabled={joining}
            autoFocus={!p.touch}
            autoComplete="nickname"
            maxLength={60}
          />
          {p.error && <p className="msg-error" role="alert">{p.error}</p>}
          <button className="btn btn-dark join-btn" onClick={p.onJoin} disabled={joining}>
            {joining ? "Подключение…" : "Присоединиться"}
          </button>
          <p className="lobby-note">Микрофон и камеру можно включить или выключить в любой момент во встрече.</p>
        </div>
      </div>
    </main>
  );
}
