"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Track, type Participant, type RemoteAudioTrack } from "livekit-client";
import { Icon } from "./icons";

export type TileItem = {
  key: string;
  participant: Participant;
  source: Track.Source;
  local: boolean;
};

function hueFor(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}

type Props = {
  item: TileItem;
  variant: "grid" | "main" | "strip";
  style?: CSSProperties;
  pinned: boolean;
  canPin: boolean;
  handUp: boolean;
  onPin: () => void;
  /** Если передан — на своей плитке показывается кнопка переворота камеры (телефоны). */
  onFlip?: () => void;
  /** Громкость звука чужой демонстрации экрана (0…1) и её изменение. */
  volume?: number;
  onVolume?: (v: number) => void;
};

export function Tile({ item, variant, style, pinned, canPin, handUp, onPin, onFlip, volume = 1, onVolume }: Props) {
  const { participant, source, local } = item;
  const isScreen = source === Track.Source.ScreenShare;
  const pub = participant.getTrackPublication(source);
  const track = pub?.track;
  const videoOn = !!track && !pub?.isMuted;
  const videoRef = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const lastVolume = useRef(1);
  const [nativeFs, setNativeFs] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const fs = nativeFs || pseudoFs;
  const [canPlayer, setCanPlayer] = useState(false);
  useEffect(() => { setCanPlayer(window.matchMedia("(pointer: coarse)").matches); }, []);

  if (volume > 0) lastVolume.current = volume;

  // Полноэкранный режим: нативный (Fullscreen API), а где его нет (iPhone) — «псевдо» поверх страницы.
  useEffect(() => {
    const onChange = () => setNativeFs(document.fullscreenElement === tileRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!pseudoFs) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPseudoFs(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pseudoFs]);

  /**
   * Телефон: открыть демонстрацию во встроенном видеоплеере системы (iPhone — системный плеер,
   * Android — полноэкранный плеер браузера). Звук демонстрации передаём плееру, а наш канал на это время глушим.
   */
  async function openInPlayer() {
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean }) | null;
    if (!el || !track) return;
    const remoteAudio = !local ? (participant.getTrackPublication(Track.Source.ScreenShareAudio)?.track as RemoteAudioTrack | undefined) : undefined;
    const previousVolume = volume;
    let restored = false;

    const restore = () => {
      if (restored) return;
      restored = true;
      el.removeEventListener("webkitendfullscreen", restore);
      document.removeEventListener("fullscreenchange", onFs);
      el.controls = false;
      el.muted = true;
      track.attach(el);
      el.style.transform = "none";
      if (remoteAudio) onVolume?.(previousVolume);
    };
    const onFs = () => { if (document.fullscreenElement !== el) restore(); };

    try {
      if (remoteAudio) onVolume?.(0);
      el.srcObject = new MediaStream([track.mediaStreamTrack, ...(remoteAudio ? [remoteAudio.mediaStreamTrack] : [])]);
      el.muted = false;
      el.controls = true;
      if (el.readyState < 1) {
        await new Promise<void>((resolve) => {
          el.addEventListener("loadedmetadata", () => resolve(), { once: true });
          window.setTimeout(resolve, 2000);
        });
      }
      await el.play().catch(() => {});
      el.addEventListener("webkitendfullscreen", restore);
      if (el.webkitEnterFullscreen && el.webkitSupportsFullscreen !== false) {
        el.webkitEnterFullscreen();
      } else if (el.requestFullscreen) {
        document.addEventListener("fullscreenchange", onFs);
        await el.requestFullscreen();
      } else {
        throw new Error("no-player");
      }
    } catch {
      restore();
    }
  }

  async function toggleFullscreen() {
    const el = tileRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!el) return;
    if (document.fullscreenElement === el) { await document.exitFullscreen().catch(() => {}); return; }
    if (pseudoFs) { setPseudoFs(false); return; }
    try {
      if (el.requestFullscreen) { await el.requestFullscreen(); return; }
      if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
    } catch {}
    setPseudoFs(true);
  }

  // Трек привязываем к <video> уже после того, как элемент появился в DOM
  // (из-за этого раньше пропадало собственное изображение).
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track || !videoOn) return;
    track.attach(el);
    // Картинку НИКОГДА не отзеркаливаем: ни свою, ни чужую (старые версии LiveKit
    // сами зеркалили превью фронтальной камеры — перебиваем это явно).
    el.style.transform = "none";
    // Если что-то (браузер, расширение) попытается отзеркалить видео — возвращаем как есть.
    const guard = new MutationObserver(() => { if (el.style.transform !== "none") el.style.transform = "none"; });
    guard.observe(el, { attributes: true, attributeFilter: ["style"] });
    return () => {
      guard.disconnect();
      track.detach(el);
    };
  }, [track, videoOn]);

  const name = participant.name || participant.identity;
  const audioPub = isScreen ? participant.getTrackPublication(Track.Source.ScreenShareAudio) : undefined;
  const hasAudio = !!audioPub && (local || !!audioPub.track);
  const label = isScreen
    ? local ? `Вы показываете экран${hasAudio ? " · со звуком" : ""}` : `${name} — экран${hasAudio ? " · звук" : ""}`
    : local ? `${name} (вы)` : name;

  const micOff = !isScreen && !participant.isMicrophoneEnabled;
  const speaking = !isScreen && participant.isSpeaking;
  const hue = hueFor(name);

  // Экран и закреплённый главный кадр показываем целиком (contain),
  // в сетке — заполняем плитку (cover), поэтому размер плиток не «прыгает».
  const fit = isScreen || variant === "main" ? "contain" : "cover";

  return (
    <div
      ref={tileRef}
      className={`tile tile-${variant} ${speaking ? "speaking" : ""} ${isScreen ? "is-screen" : ""} ${pseudoFs ? "tile-fs-fallback" : ""}`}
      style={{ ...style, ["--hue" as string]: hue }}
      onDoubleClick={isScreen ? toggleFullscreen : undefined}
    >
      {videoOn ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ objectFit: fit, transform: "none" }}
        />
      ) : (
        <div className="tile-empty">
          <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>
        </div>
      )}

      {micOff && (
        <div className="tile-badge tile-mic" title="Микрофон выключен"><Icon name="micOff" size={15} /></div>
      )}
      {handUp && <div className="tile-badge tile-hand" title="Поднял руку"><Icon name="hand" size={15} /></div>}

      {(canPin || pinned) && (
        <button
          className={`tile-pin ${pinned ? "on" : ""}`}
          onClick={onPin}
          title={pinned ? "Открепить" : "Закрепить на главном экране"}
          aria-label={pinned ? "Открепить" : "Закрепить"}
        >
          <Icon name="pin" size={16} />
        </button>
      )}

      {onFlip && videoOn && (
        <button className="tile-flip" onClick={onFlip} title="Переключить камеру (передняя/задняя)" aria-label="Переключить камеру">
          <Icon name="flip" size={20} />
        </button>
      )}

      {isScreen && (
        <div className="tile-media" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {hasAudio && !local && onVolume && (
            <>
              <button
                className="tm-btn"
                onClick={() => onVolume(volume > 0 ? 0 : lastVolume.current || 1)}
                title={volume > 0 ? "Выключить звук демонстрации" : "Включить звук демонстрации"}
                aria-label="Звук демонстрации"
              >
                <Icon name={volume > 0 ? "volume" : "volumeOff"} size={18} />
              </button>
              <input
                className="tm-range"
                type="range" min={0} max={1} step={0.05}
                value={volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-label="Громкость демонстрации экрана"
              />
            </>
          )}
          {canPlayer && videoOn && (
            <button className="tm-btn" onClick={openInPlayer} title="Открыть во встроенном видеоплеере" aria-label="Открыть во встроенном видеоплеере">
              <Icon name="player" size={18} />
            </button>
          )}
          <button className="tm-btn" onClick={toggleFullscreen} title={fs ? "Выйти из полного экрана" : "На весь экран"} aria-label={fs ? "Выйти из полного экрана" : "На весь экран"}>
            <Icon name={fs ? "fullscreenExit" : "fullscreen"} size={18} />
          </button>
        </div>
      )}

      <div className="tile-label">{label}</div>
    </div>
  );
}
