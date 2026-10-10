"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type LocalVideoTrack, type RemoteAudioTrack, type RemoteTrack } from "livekit-client";
import { Icon } from "./icons";
import { Lobby } from "./lobby";
import { BoardSync, BOARD_CURSOR_TOPIC, BOARD_DRAFT_TOPIC } from "./board/sync";
import { FlipProcessor } from "./flip-processor";
import { Whiteboard } from "./board/Whiteboard";
import { Tile, type TileItem } from "./tile";
import { GAP, fitCells, pickGrid, pickSplit, useElementSize } from "./stage-layout";

type Msg = { from: string; text: string; time: string; mine: boolean };
type Panel = null | "chat" | "people";
type Facing = "user" | "environment";
const NAME_KEY = "meetspace:name";
const SHARE_AUDIO_KEY = "meetspace:shareAudio";
const HIDE_HINT = "Коснитесь экрана, чтобы снова показать кнопки";
const FLIP_KEY = "meetspace:unmirror";
type Devices = { audioinput: MediaDeviceInfo[]; videoinput: MediaDeviceInfo[]; audiooutput: MediaDeviceInfo[] };

/** Телефон/планшет: основной указатель — палец. */
const isTouchDevice = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** Для телефонов снимаем в меньшем разрешении — меньше трафика, нагрева и задержки. */
function cameraOptions(facing: Facing) {
  const resolution = isTouchDevice() ? { width: 960, height: 540, frameRate: 24 } : { width: 1280, height: 720, frameRate: 30 };
  return { resolution, facingMode: facing };
}

const nowTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function RoomClient({ room: roomName }: { room: string }) {
  const roomRef = useRef<Room | null>(null);
  const joiningRef = useRef(false);
  const leavingRef = useRef(false);
  const panelRef = useRef<Panel>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const boardRef = useRef<BoardSync | null>(null);
  const screenVolRef = useRef<Record<string, number>>({});
  const hintedRef = useRef(false);
  const flipFixRef = useRef(false);
  const topbarRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const saTopRef = useRef<HTMLElement>(null);
  const saBottomRef = useRef<HTMLElement>(null);
  const fileShareRef = useRef<{ stop: () => void } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const facingRef = useRef<Facing>("user");

  // Любое событие LiveKit → перерисовка. Состояние плиток всегда берём из самой комнаты.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [message, setMessage] = useState("");
  const [unread, setUnread] = useState(0);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [hands, setHands] = useState<Record<string, boolean>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [shareDialog, setShareDialog] = useState(false);
  const [shareAudio, setShareAudio] = useState(true);
  const [screenVolumes, setScreenVolumes] = useState<Record<string, number>>({});
  const [uiHidden, setUiHidden] = useState(false);
  const [flipFix, setFlipFix] = useState(false);
  const [prejoinMic, setPrejoinMic] = useState(true);
  const [prejoinCam, setPrejoinCam] = useState(true);
  const [touch, setTouch] = useState(false);
  const [facing, setFacing] = useState<Facing>("user");
  const [flipping, setFlipping] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [clock, setClock] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [bars, setBars] = useState({ t: 56, c: 88, st: 0, sb: 0 });
  const [animReady, setAnimReady] = useState(false);
  const [devices, setDevices] = useState<Devices>({ audioinput: [], videoinput: [], audiooutput: [] });

  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const [bodyRef, body] = useElementSize<HTMLDivElement>();

  // Телефон: определяем тип указателя и подгоняем высоту под реальную видимую область
  // (адресная строка, экранная клавиатура на iOS), чтобы панель кнопок не пряталась.
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const onMq = () => setTouch(mq.matches);
    onMq();
    mq.addEventListener?.("change", onMq);

    // Подгонка под экранную клавиатуру: только когда она реально открыта. В остальное время
    // высоту задаёт CSS (100dvh) — так панели не «дёргаются» при сворачивании адресной строки.
    const vv = window.visualViewport;
    const root = document.documentElement;
    const sync = () => {
      if (!vv) return;
      const keyboard = window.innerHeight - vv.height > 120;
      if (keyboard) {
        root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
        root.style.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
      } else {
        root.style.removeProperty("--app-h");
        root.style.removeProperty("--app-top");
      }
    };
    sync();
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    return () => {
      mq.removeEventListener?.("change", onMq);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
    };
  }, []);

  // Реальные размеры панелей (с учётом «чёлки» и жестовой полосы) — по ним считаем отступы области видео.
  useLayoutEffect(() => {
    if (!joined) return;
    const measure = () => {
      const next = {
        t: topbarRef.current?.offsetHeight ?? 56,
        c: controlsRef.current?.offsetHeight ?? 88,
        st: saTopRef.current?.offsetHeight ?? 0,
        sb: saBottomRef.current?.offsetHeight ?? 0,
      };
      setBars((cur) => (cur.t === next.t && cur.c === next.c && cur.st === next.st && cur.sb === next.sb ? cur : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    [topbarRef, controlsRef, saTopRef, saBottomRef].forEach((r) => r.current && ro.observe(r.current));
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [joined]);

  // Плавные переходы включаем чуть позже входа, чтобы первая отрисовка не «ехала».
  useEffect(() => {
    if (!joined) return;
    const timer = window.setTimeout(() => setAnimReady(true), 500);
    return () => { window.clearTimeout(timer); setAnimReady(false); };
  }, [joined]);

  // Во встрече запрещаем «щипок»-масштаб всей страницы (на доске свои жесты) — иначе вёрстка «уезжает».
  useEffect(() => {
    if (!joined) return;
    const prevent = (e: Event) => e.preventDefault();
    const resume = () => { audioCtxRef.current?.resume().catch(() => {}); };
    document.addEventListener("gesturestart", prevent);
    document.addEventListener("gesturechange", prevent);
    document.addEventListener("pointerdown", resume);
    return () => {
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
    };
  }, [joined]);

  // Не даём экрану телефона гаснуть во время встречи.
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    const request = async () => {
      try {
        const lock = await navigator.wakeLock?.request("screen");
        if (cancelled) { lock?.release().catch(() => {}); return; }
        if (lock) wakeLockRef.current = lock;
      } catch {}
    };
    request();
    const onVisible = () => { if (document.visibilityState === "visible") request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [joined]);

  useEffect(() => {
    // На телефонах браузер экран показывать не умеет (Chrome Android объявляет API, но всегда отказывает).
    setCanShare(isTouchDevice() || !!navigator.mediaDevices?.getDisplayMedia);
    const tick = () => setClock(nowTime());
    tick();
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) setName(saved);
      const sa = localStorage.getItem(SHARE_AUDIO_KEY);
      if (sa !== null) setShareAudio(sa === "1");
      // По умолчанию картинка передней камеры показывается ровно так, как её отдаёт телефон;
      // задняя камера не обрабатывается никогда. Разворот по горизонтали — только по выбору в настройках.
      const ff = localStorage.getItem(FLIP_KEY) === "1";
      setFlipFix(ff);
      flipFixRef.current = ff;
    } catch {}
  }, []);

  useEffect(() => { facingRef.current = facing; }, [facing]);

  // Если открыли доску/чат/настройки — панели кнопок снова показываем.
  useEffect(() => {
    if (boardOpen || panel || showSettings || shareDialog) {
      setUiHidden(false);
      setNotice((n) => (n === HIDE_HINT ? "" : n));
    }
  }, [boardOpen, panel, showSettings, shareDialog]);

  useEffect(() => {
    panelRef.current = panel;
    if (panel === "chat") setUnread(0);
  }, [panel]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, panel]);

  useEffect(() => {
    return () => {
      leavingRef.current = true;
      boardRef.current?.stop();
      boardRef.current = null;
      fileShareRef.current?.stop();
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      roomRef.current?.disconnect();
      roomRef.current = null;
      window.clearTimeout(noticeTimer.current);
    };
  }, []);

  function notify(text: string) {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 5000);
  }

  const refreshDevices = useCallback(async (requestPermissions = false) => {
    try {
      const [audioinput, videoinput, audiooutput] = await Promise.all([
        Room.getLocalDevices("audioinput", requestPermissions),
        Room.getLocalDevices("videoinput", requestPermissions),
        Room.getLocalDevices("audiooutput", requestPermissions)
      ]);
      setDevices({ audioinput, videoinput, audiooutput });
    } catch {}
  }, []);

  useEffect(() => {
    if (showSettings) refreshDevices(true);
  }, [showSettings, refreshDevices]);

  async function join() {
    if (joiningRef.current || roomRef.current || joined) return;
    if (!name.trim()) {
      setError("Введите ваше имя.");
      return;
    }

    try { localStorage.setItem(NAME_KEY, name.trim()); } catch {}
    // Создаём аудио-контекст прямо в обработчике нажатия (иначе браузер телефона оставит его «спящим»).
    if (isTouchDevice() && !audioCtxRef.current) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      } catch {}
    }
    audioCtxRef.current?.resume().catch(() => {});
    joiningRef.current = true;
    leavingRef.current = false;
    setJoining(true);
    setError("");

    try {
      const response = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomName, name: name.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ошибка авторизации");

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication, participant) => {
          if (track.kind === Track.Kind.Audio) {
            if (publication.source === Track.Source.ScreenShareAudio) {
              const audio = track as RemoteAudioTrack;
              // На iPhone громкость у <audio> менять нельзя — пускаем звук через WebAudio и регулируем усиление.
              if (isTouchDevice() && audioCtxRef.current && typeof audio.setAudioContext === "function") {
                audio.setAudioContext(audioCtxRef.current);
              }
              audio.setVolume(screenVolRef.current[participant.identity] ?? 1);
            }
            track.attach(); // голос и звук демонстрации
          }
          bump();
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach();
          bump();
        })
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          boardRef.current?.dropCursor(p.identity);
          setHands((prev) => {
            const next = { ...prev };
            delete next[p.identity];
            return next;
          });
          bump();
        })
        .on(RoomEvent.ParticipantConnected, bump)
        .on(RoomEvent.TrackPublished, bump)
        .on(RoomEvent.TrackUnpublished, bump)
        .on(RoomEvent.TrackMuted, bump)
        .on(RoomEvent.TrackUnmuted, bump)
        .on(RoomEvent.LocalTrackPublished, bump)
        .on(RoomEvent.LocalTrackUnpublished, bump)
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
        .on(RoomEvent.ActiveSpeakersChanged, bump)
        .on(RoomEvent.ParticipantNameChanged, bump)
        .on(RoomEvent.MediaDevicesChanged, () => { refreshDevices(); bump(); })
        .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
          if (topic === BOARD_DRAFT_TOPIC) {
            boardRef.current?.handleDraft(payload);
            return;
          }
          if (topic === BOARD_CURSOR_TOPIC) {
            if (participant) boardRef.current?.handleCursor(payload, participant.identity, participant.name || participant.identity);
            return;
          }
          try {
            const parsed = JSON.parse(new TextDecoder().decode(payload));
            if (parsed.type === "chat") {
              setMessages((prev) => [...prev, {
                from: participant?.name || participant?.identity || "Участник",
                text: String(parsed.text),
                time: nowTime(),
                mine: false
              }]);
              if (panelRef.current !== "chat") setUnread((n) => n + 1);
            } else if (parsed.type === "hand" && participant) {
              setHands((prev) => ({ ...prev, [participant.identity]: !!parsed.up }));
            }
          } catch {}
        })
        .on(RoomEvent.Disconnected, () => {
          boardRef.current?.stop();
          boardRef.current = null;
          setBoardOpen(false);
          roomRef.current = null;
          setJoined(false);
          setPanel(null);
          if (!leavingRef.current) setError("Соединение с комнатой прервано. Войдите снова.");
        });

      await room.connect(data.url, data.token);

      // Онлайн-доска: общая для всех участников комнаты, данные идут через LiveKit.
      const board = new BoardSync(room, {
        onOpen: (open, by, mine) => {
          setBoardOpen(open);
          if (!mine && by && open) notify(`${by} открыл(а) онлайн-доску`);
        },
        onCursors: () => {}
      });
      boardRef.current = board;
      board.start();

      setJoined(true);

      // Включаем только то, что выбрано на экране входа. Нет камеры/микрофона или нет
      // разрешения — не повод не пускать во встречу.
      if (prejoinMic) {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          notify("Не удалось включить микрофон. Проверьте разрешения браузера.");
        }
      }
      if (prejoinCam) {
        try {
          await room.localParticipant.setCameraEnabled(true, cameraOptions(facing));
          await syncFlip();
        } catch {
          notify("Не удалось включить камеру. Проверьте разрешения браузера.");
        }
      }
      bump();
      refreshDevices();
      setAudioBlocked(!room.canPlaybackAudio);
    } catch (e) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setJoined(false);
      setError(e instanceof Error ? e.message : "Не удалось подключиться");
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  }

  async function toggleMic() {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    try {
      await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
    } catch {
      notify("Не удалось переключить микрофон.");
    }
    bump();
  }

  async function toggleCamera() {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    try {
      await lp.setCameraEnabled(!lp.isCameraEnabled, cameraOptions(facing));
      if (lp.isCameraEnabled) await syncFlip();
    } catch {
      notify("Не удалось переключить камеру. Проверьте разрешения браузера.");
    }
    bump();
  }

  /**
   * Исправление «зеркальной» камеры (по желанию пользователя). Задняя камера никогда не разворачивается.
   * В самом приложении картинка нигде не зеркалится.
   */
  async function syncFlip() {
    const track = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as LocalVideoTrack | undefined;
    if (!track) return;
    const want = flipFixRef.current && facingRef.current === "user";
    try {
      if (want && !track.getProcessor()) await track.setProcessor(new FlipProcessor());
      else if (!want && track.getProcessor()) await track.stopProcessor();
    } catch {
      notify("Не удалось применить исправление зеркала в этом браузере.");
    }
  }

  async function changeFlipFix(v: boolean) {
    flipFixRef.current = v;
    setFlipFix(v);
    try { localStorage.setItem(FLIP_KEY, v ? "1" : "0"); } catch {}
    await syncFlip();
    bump();
  }

  /** Переворот камеры телефона: передняя ⇄ задняя. */
  async function flipCamera() {
    const lp = roomRef.current?.localParticipant;
    const track = lp?.getTrackPublication(Track.Source.Camera)?.videoTrack as LocalVideoTrack | undefined;
    if (!track || flipping) return;
    const next: Facing = facing === "user" ? "environment" : "user";
    setFlipping(true);
    try {
      await track.restartTrack(cameraOptions(next));
      facingRef.current = next;
      setFacing(next);
      await syncFlip();
    } catch {
      notify("Не удалось переключить камеру.");
      try { await track.restartTrack(cameraOptions(facing)); } catch {}
    } finally {
      setFlipping(false);
      bump();
    }
  }

  async function enableAudio() {
    try { await roomRef.current?.startAudio(); } catch {}
    setAudioBlocked(!(roomRef.current?.canPlaybackAudio ?? true));
  }

  /** Кнопка «Показать экран»: если показ идёт — останавливаем, иначе спрашиваем про звук. */
  async function toggleScreen() {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    if (lp.isScreenShareEnabled) {
      fileShareRef.current?.stop();
      fileShareRef.current = null;
      try { await lp.setScreenShareEnabled(false); } catch {}
      bump();
      return;
    }
    setShareDialog(true);
  }

  /**
   * Телефоны (Chrome/Safari/Firefox) не умеют захватывать экран, поэтому вместо экрана
   * показываем фото или видео из галереи — оно идёт как обычная «демонстрация» (с громкостью и полным экраном).
   * Видео переносим через canvas + WebAudio: так работает и на iPhone, где у <video> нет captureStream.
   */
  async function shareFile(file: File) {
    setShareDialog(false);
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    fileShareRef.current?.stop();
    fileShareRef.current = null;

    const ext = (file.name.toLowerCase().split(".").pop() || "");
    const isImage = file.type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext);
    const isVideo = file.type.startsWith("video/") || ["mp4", "mov", "m4v", "webm", "mkv", "3gp"].includes(ext);

    const url = URL.createObjectURL(file);
    const published: Array<Parameters<typeof lp.unpublishTrack>[0]> = [];
    const cleanups: Array<() => void> = [];
    const stop = () => {
      cleanups.splice(0).forEach((fn) => { try { fn(); } catch {} });
      published.forEach((t) => { lp.unpublishTrack(t, true).catch(() => {}); });
      URL.revokeObjectURL(url);
      bump();
    };
    const schedule = (video: HTMLVideoElement, cb: () => void) => {
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(cb); else requestAnimationFrame(cb);
    };

    try {
      if (isImage) {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("decode"));
          el.src = url;
        });
        const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(2, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(2, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d")!;
        const draw = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        draw();
        const mst = canvas.captureStream(5).getVideoTracks()[0];
        cleanups.push(() => mst.stop());
        // Перерисовываем раз в секунду, чтобы кадры не прекращались и новые участники сразу видели картинку.
        const timer = window.setInterval(draw, 1000);
        cleanups.push(() => window.clearInterval(timer));
        const pub = await lp.publishTrack(mst, { source: Track.Source.ScreenShare, name: "photo" });
        if (pub.track) published.push(pub.track);
      } else if (isVideo) {
        const video = document.createElement("video");
        video.src = url;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.preload = "auto";
        // В DOM, но невидимо: так iOS гарантированно декодирует кадры.
        video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none";
        document.body.appendChild(video);
        cleanups.push(() => { video.pause(); video.removeAttribute("src"); video.load(); video.remove(); });

        // Сначала со звуком; если браузер не разрешает автозапуск со звуком — без звука.
        let withSound = true;
        try {
          await video.play();
        } catch {
          video.muted = true;
          withSound = false;
          await video.play();
        }
        if (!video.videoWidth) {
          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error("decode"));
            window.setTimeout(() => reject(new Error("decode")), 6000);
          });
        }

        // Картинка: кадры видео → canvas → поток.
        const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext("2d")!;
        let alive = true;
        cleanups.push(() => { alive = false; });
        const draw = () => {
          if (!alive) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          schedule(video, draw);
        };
        draw();
        const vtrack = canvas.captureStream(30).getVideoTracks()[0];
        cleanups.push(() => vtrack.stop());
        const pubV = await lp.publishTrack(vtrack, { source: Track.Source.ScreenShare, name: "video" });
        if (pubV.track) published.push(pubV.track);

        // Звук: берём из элемента через WebAudio (у себя не воспроизводим — иначе микрофон подхватит эхо).
        if (withSound) {
          await new Promise((r) => window.setTimeout(r, 400));
          const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean };
          const hasAudio = v.webkitAudioDecodedByteCount === undefined ? (v.mozHasAudio ?? true) : v.webkitAudioDecodedByteCount > 0;
          if (hasAudio) {
            if (!audioCtxRef.current) {
              const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
              if (AC) audioCtxRef.current = new AC();
            }
            const ctxA = audioCtxRef.current;
            if (ctxA) {
              await ctxA.resume().catch(() => {});
              const src = ctxA.createMediaElementSource(video);
              const dest = ctxA.createMediaStreamDestination();
              src.connect(dest);
              cleanups.push(() => src.disconnect());
              const atrack = dest.stream.getAudioTracks()[0];
              if (atrack) {
                const pubA = await lp.publishTrack(atrack, { source: Track.Source.ScreenShareAudio, name: "video-audio" });
                if (pubA.track) published.push(pubA.track);
              }
            }
          }
        } else {
          notify("Видео показано без звука: браузер не разрешил воспроизведение со звуком.");
        }
      } else {
        throw new Error("type");
      }
      fileShareRef.current = { stop };
    } catch (e) {
      stop();
      const reason = e instanceof Error ? e.message : "";
      notify(
        reason === "decode"
          ? "Не удалось открыть файл: браузер не поддерживает этот формат (например, HEVC/H.265). Попробуйте другое видео или фото."
          : reason === "type"
            ? "Выберите фото или видео."
            : "Не удалось показать файл. Попробуйте ещё раз или выберите другой."
      );
    }
    bump();
  }

  async function startScreen() {
    const lp = roomRef.current?.localParticipant;
    setShareDialog(false);
    try { localStorage.setItem(SHARE_AUDIO_KEY, shareAudio ? "1" : "0"); } catch {}
    if (!lp) return;
    try {
      await lp.setScreenShareEnabled(true, { audio: shareAudio, contentHint: "detail" });
    } catch (e) {
      // Пользователь просто закрыл окно выбора экрана — это не ошибка.
      if (!(e instanceof Error) || e.name !== "NotAllowedError") notify("Не удалось начать демонстрацию экрана.");
    }
    bump();
  }

  /** Громкость звука чужой демонстрации экрана. */
  function setScreenVolume(identity: string, v: number) {
    screenVolRef.current = { ...screenVolRef.current, [identity]: v };
    setScreenVolumes(screenVolRef.current);
    const pub = roomRef.current?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShareAudio);
    (pub?.track as RemoteAudioTrack | undefined)?.setVolume(v);
  }

  /** На телефоне касание видео прячет/показывает панели — плитки занимают весь экран. */
  function onStageClick(e: React.MouseEvent) {
    if (!touch || boardOpen) return;
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a, .tile-media")) return;
    setUiHidden((hidden) => {
      if (hidden) setNotice((n) => (n === HIDE_HINT ? "" : n));
      if (!hidden && !hintedRef.current) {
        hintedRef.current = true;
        notify(HIDE_HINT);
      }
      return !hidden;
    });
  }

  async function toggleHand() {
    const room = roomRef.current;
    if (!room) return;
    const id = room.localParticipant.identity;
    const up = !hands[id];
    setHands((prev) => ({ ...prev, [id]: up }));
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "hand", up })), { reliable: true });
    } catch {}
  }

  async function sendMessage() {
    const text = message.trim();
    const room = roomRef.current;
    if (!text || !room) return;
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "chat", text })), { reliable: true });
      setMessages((prev) => [...prev, { from: room.localParticipant.name || "Вы", text, time: nowTime(), mine: true }]);
      setMessage("");
    } catch {
      notify("Сообщение не отправлено.");
    }
  }

  function toggleBoard() {
    boardRef.current?.setOpen(!boardOpen);
  }

  function leave() {
    leavingRef.current = true;
    boardRef.current?.stop();
    roomRef.current?.disconnect();
    roomRef.current = null;
    setJoined(false);
    window.location.href = "/";
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      notify("Не удалось скопировать ссылку.");
    }
  }

  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  /* ───────────────────────── Экран входа ───────────────────────── */
  if (!joined) {
    return (
      <Lobby
        roomName={roomName}
        name={name}
        onName={setName}
        mic={prejoinMic}
        onMic={setPrejoinMic}
        cam={prejoinCam}
        onCam={setPrejoinCam}
        facing={facing}
        onFacing={setFacing}
        flipFix={flipFix}
        touch={touch}
        joining={joining}
        error={error}
        onJoin={join}
      />
    );
  }

  /* ───────────────────────── Плитки ───────────────────────── */
  const room = roomRef.current;
  const local = room?.localParticipant;
  const remotes = room ? Array.from(room.remoteParticipants.values()) : [];
  const everyone = local ? [local, ...remotes] : remotes;

  // Камера есть у каждого участника (с аватаркой, если выключена);
  // отдельная плитка для демонстрации экрана — только пока она идёт.
  const tiles: TileItem[] = [];
  for (const p of everyone) {
    const isLocal = p === local;
    tiles.push({ key: `${p.identity}:cam`, participant: p, source: Track.Source.Camera, local: isLocal });
    const screen = p.getTrackPublication(Track.Source.ScreenShare);
    if (screen?.track) {
      tiles.push({ key: `${p.identity}:screen`, participant: p, source: Track.Source.ScreenShare, local: isLocal });
    }
  }

  // Приоритет главного экрана: закреплённая плитка → чужая демонстрация → своя демонстрация.
  const screens = tiles.filter((t) => t.source === Track.Source.ScreenShare);
  const spotlight = tiles.find((t) => t.key === pinnedKey) ?? screens.find((t) => !t.local) ?? screens[0];
  const others = spotlight ? tiles.filter((t) => t !== spotlight) : tiles;

  // Кнопка переворота: только на телефонах/планшетах, когда камера включена и камер больше одной.
  const canFlip = touch && !!local?.isCameraEnabled && devices.videoinput.length > 1;

  const renderTile = (t: TileItem, variant: "grid" | "main" | "strip", style?: React.CSSProperties) => (
    <Tile
      key={t.key}
      item={t}
      variant={variant}
      style={style}
      pinned={pinnedKey === t.key}
      canPin={tiles.length > 1}
      handUp={!!hands[t.participant.identity] && t.source === Track.Source.Camera}
      onPin={() => setPinnedKey((cur) => (cur === t.key ? null : t.key))}
      onFlip={canFlip && t.local && t.source === Track.Source.Camera ? flipCamera : undefined}
      volume={screenVolumes[t.participant.identity] ?? 1}
      onVolume={(v) => setScreenVolume(t.participant.identity, v)}
    />
  );

  // Что скрыто на телефоне: по касанию — обе панели; доска на весь экран — только верхняя (кнопки остаются).
  const phoneBoard = touch && boardOpen;
  const hideAll = touch && uiHidden && !boardOpen && !panel && !showSettings && !shareDialog;
  const hideTop = hideAll || phoneBoard;
  const hideBottom = hideAll;
  const padTop = hideTop ? bars.st : bars.t;
  const padBottom = hideBottom ? bars.sb : bars.c;

  // Размеры плиток считаем по текущему (анимируемому) размеру области, а «форму» сетки (колонки/ряды) —
  // по конечному, поэтому при скрытии панелей плитки плавно растут и не перестраиваются посреди движения.
  const finalShape = { w: stage.width, h: Math.max(0, body.height - padTop - padBottom) };

  let stageContent: React.ReactNode = null;
  if (stage.width > 0 && stage.height > 0) {
    if (boardOpen && boardRef.current && phoneBoard) {
      stageContent = (
        <div className="board-full">
          <Whiteboard sync={boardRef.current} roomName={roomName} touch={touch} onClose={toggleBoard} />
        </div>
      );
    } else if (boardOpen && boardRef.current) {
      // Доска занимает главную область, участники — колонка справа (на телефоне — лента снизу).
      const s = pickSplit(tiles.length, stage.width, stage.height, GAP, finalShape);
      stageContent = (
        <div className={`split ${s.narrow ? "narrow" : ""}`}>
          <div className="split-main">
            <Whiteboard sync={boardRef.current} roomName={roomName} touch={touch} onClose={toggleBoard} />
          </div>
          <div className="split-side" style={s.narrow ? { height: s.h } : { width: s.colW }}>
            {tiles.map((t) => renderTile(t, "strip", { width: s.w, height: s.h }))}
          </div>
        </div>
      );
    } else if (spotlight) {
      const s = pickSplit(others.length, stage.width, stage.height, GAP, finalShape);
      stageContent = (
        <div className={`split ${s.narrow ? "narrow" : ""}`}>
          <div className="split-main">{renderTile(spotlight, "main", { width: "100%", height: "100%" })}</div>
          {others.length > 0 && (
            <div className="split-side" style={s.narrow ? { height: s.h } : { width: s.colW }}>
              {others.map((t) => renderTile(t, "strip", { width: s.w, height: s.h }))}
            </div>
          )}
        </div>
      );
    } else {
      const shape = pickGrid(tiles.length, finalShape.w, finalShape.h);
      const g = fitCells(shape.cols, shape.rows, stage.width, stage.height);
      stageContent = (
        <div className="grid" style={{ gap: GAP }}>
          {tiles.map((t) => renderTile(t, "grid", { width: g.w, height: g.h }))}
        </div>
      );
    }
  }

  const count = everyone.length;
  const mic = !!local?.isMicrophoneEnabled;
  const camera = !!local?.isCameraEnabled;
  const sharing = !!local?.isScreenShareEnabled;
  const handUp = !!(local && hands[local.identity]);

  const activeDevice = (kind: MediaDeviceKind) => room?.getActiveDevice(kind) ?? "";
  const pickDevice = async (kind: MediaDeviceKind, id: string) => {
    try {
      await room?.switchActiveDevice(kind, id);
    } catch {
      notify("Не удалось переключить устройство.");
    }
    bump();
  };

  return (
    <main className={`room ${hideTop ? "hide-top" : ""} ${hideBottom ? "hide-bottom" : ""} ${phoneBoard ? "board-full" : ""}`}>
      <i className="sa-probe sa-top" ref={saTopRef as React.RefObject<HTMLElement>} />
      <i className="sa-probe sa-bottom" ref={saBottomRef as React.RefObject<HTMLElement>} />
      <header className="topbar" ref={topbarRef}>
        <div className="topbar-left">
          <span className="clock">{clock}</span>
          <span className="sep" />
          <span className="room-code" title={roomName}>{roomName}</span>
          <button className="icon-btn" onClick={copyLink} title="Скопировать ссылку на встречу" aria-label="Скопировать ссылку">
            <Icon name={copied ? "check" : "copy"} size={17} />
          </button>
          {copied && <span className="copied">Ссылка скопирована</span>}
        </div>
        <button className={`people-pill ${panel === "people" ? "on" : ""}`} onClick={() => togglePanel("people")} title="Участники">
          <Icon name="people" size={18} /> {count}
        </button>
      </header>

      <div
        className={`room-body ${animReady ? "anim" : ""}`}
        ref={bodyRef}
        style={{ paddingTop: padTop, paddingBottom: padBottom }}
      >
        <section className="stage" ref={stageRef} onClick={onStageClick}>{stageContent}</section>

        {panel && (
          <aside className="panel" role="complementary">
            <div className="panel-head">
              <b>{panel === "chat" ? "Чат" : `Участники (${count})`}</b>
              <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Закрыть панель"><Icon name="close" size={20} /></button>
            </div>

            {panel === "people" && (
              <div className="panel-scroll">
                {everyone.map((p) => (
                  <div className="person" key={p.identity}>
                    <span className="person-ava">{(p.name || p.identity).slice(0, 1).toUpperCase()}</span>
                    <span className="person-name">{p.name || p.identity}{p === local && <small> (вы)</small>}</span>
                    {hands[p.identity] && <span className="person-icon" title="Поднял руку"><Icon name="hand" size={16} /></span>}
                    <span className={`person-icon ${p.isMicrophoneEnabled ? "" : "off"}`}>
                      <Icon name={p.isMicrophoneEnabled ? "mic" : "micOff"} size={16} />
                    </span>
                  </div>
                ))}
              </div>
            )}

            {panel === "chat" && (
              <div className="chat">
                <div className="messages">
                  {messages.length === 0 && <div className="empty-state">Сообщений пока нет. Напишите первым.</div>}
                  {messages.map((m, i) => (
                    <div className={`message ${m.mine ? "mine" : ""}`} key={i}>
                      <div className="message-meta"><b>{m.mine ? "Вы" : m.from}</b><time>{m.time}</time></div>
                      <p>{m.text}</p>
                    </div>
                  ))}
                  <div ref={messagesEnd} />
                </div>
                <div className="chat-form">
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                    placeholder="Отправить сообщение…"
                  />
                  <button className="send-btn" onClick={sendMessage} disabled={!message.trim()} aria-label="Отправить"><Icon name="send" size={18} /></button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {audioBlocked && (
        <button className="audio-banner" onClick={enableAudio}>Нажмите, чтобы включить звук собеседников</button>
      )}
      {notice && <div className="toast" role="status">{notice}</div>}

      <footer className="controls" ref={controlsRef}>
        <div className="bar">
          <div className="control-group">
            <button className="control control-small" onClick={() => setShowSettings(true)} title="Настройки микрофона" aria-label="Настройки микрофона"><span className="chevron">⌃</span></button>
            <button className={`control control-main ${mic ? "" : "off"}`} onClick={toggleMic} title={mic ? "Выключить микрофон" : "Включить микрофон"}>
              <Icon name={mic ? "mic" : "micOff"} />
            </button>
          </div>
          <div className="control-group">
            <button className="control control-small" onClick={() => setShowSettings(true)} title="Настройки камеры" aria-label="Настройки камеры"><span className="chevron">⌃</span></button>
            <button className={`control control-main ${camera ? "" : "off"}`} onClick={toggleCamera} title={camera ? "Выключить камеру" : "Включить камеру"}>
              <Icon name={camera ? "video" : "videoOff"} />
            </button>
          </div>
          {canShare && (
            <button className={`control round ${sharing ? "on" : ""}`} onClick={toggleScreen} title={sharing ? "Остановить демонстрацию" : touch ? "Показать фото или видео" : "Показать экран"}>
              <Icon name="screen" />
            </button>
          )}
          <button className={`control round ${boardOpen ? "on" : ""}`} onClick={toggleBoard} title={boardOpen ? "Скрыть доску (у остальных она останется)" : "Открыть онлайн-доску для всех"} aria-pressed={boardOpen}>
            <Icon name="board" />
          </button>
          <button className={`control round ${panel === "chat" ? "on" : ""}`} onClick={() => togglePanel("chat")} title={panel === "chat" ? "Скрыть чат" : "Открыть чат"} aria-pressed={panel === "chat"}>
            <Icon name="chat" />
            {unread > 0 && <span className="badge">{unread > 9 ? "9+" : unread}</span>}
          </button>
          <button className={`control round hide-sm ${handUp ? "on" : ""}`} onClick={toggleHand} title={handUp ? "Опустить руку" : "Поднять руку"}>
            <Icon name="hand" />
          </button>
          <button className="control round" onClick={() => setShowSettings(true)} title="Настройки"><Icon name="settings" /></button>
          <button className="control hangup" onClick={leave} title="Выйти из встречи"><Icon name="phone" size={21} /></button>
        </div>
      </footer>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Настройки">
            <div className="settings-head">
              <div><b>Настройки</b><span>Устройства</span></div>
              <button onClick={() => setShowSettings(false)} aria-label="Закрыть">×</button>
            </div>
            <div className="settings-body">
              <label>Микрофон
                <select value={activeDevice("audioinput")} onChange={(e) => pickDevice("audioinput", e.target.value)}>
                  {devices.audioinput.length === 0 && <option value="">Устройства не найдены</option>}
                  {devices.audioinput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Микрофон"}</option>)}
                </select>
              </label>
              <label>Камера
                <select value={activeDevice("videoinput")} onChange={(e) => pickDevice("videoinput", e.target.value)}>
                  {devices.videoinput.length === 0 && <option value="">Устройства не найдены</option>}
                  {devices.videoinput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Камера"}</option>)}
                </select>
              </label>
              <label>Динамики
                <select value={activeDevice("audiooutput")} onChange={(e) => pickDevice("audiooutput", e.target.value)}>
                  {devices.audiooutput.length === 0 && <option value="">Браузер не дал список динамиков</option>}
                  {devices.audiooutput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Динамики"}</option>)}
                </select>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={flipFix} onChange={(e) => changeFlipFix(e.target.checked)} />
                Развернуть картинку передней камеры по горизонтали
              </label>
            </div>
            <div className="settings-foot">
              <button className="secondary" onClick={() => refreshDevices(true)}>Обновить устройства</button>
              <button className="primary" onClick={() => setShowSettings(false)}>Готово</button>
            </div>
          </div>
        </div>
      )}

      {shareDialog && (
        <div className="modal-backdrop" onClick={() => setShareDialog(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={touch ? "Показать с телефона" : "Показать экран"}>
            <div className="settings-head">
              <div><b>{touch ? "Показать с телефона" : "Показать экран"}</b><span>{touch ? "Фото или видео из галереи" : "Выберите, нужен ли звук"}</span></div>
              <button onClick={() => setShareDialog(false)} aria-label="Закрыть">×</button>
            </div>
            {touch ? (
              <>
                <div className="settings-body">
                  <p className="share-note" style={{ marginTop: 0 }}>
                    Браузеры на телефонах не позволяют делиться экраном — это ограничение Chrome, Safari и Firefox.
                    Вместо этого можно показать фото или видео из галереи: участники увидят его в большом окне,
                    смогут развернуть на весь экран и регулировать звук видео.
                  </p>
                </div>
                <div className="settings-foot">
                  <button className="secondary" onClick={() => setShareDialog(false)}>Отмена</button>
                  <label className="primary file-pick">
                    Выбрать файл
                    <input type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) shareFile(f); }} />
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="settings-body">
                  <label className="check-row">
                    <input type="checkbox" checked={shareAudio} onChange={(e) => setShareAudio(e.target.checked)} />
                    Передавать звук (видео, музыка, игры)
                  </label>
                  <p className="share-note">
                    Звук доступен в Chrome и Edge: при показе вкладки — звук вкладки, при показе всего экрана на Windows — звук системы.
                    В окне выбора поставьте галочку «Поделиться звуком». Участники смогут менять его громкость.
                  </p>
                </div>
                <div className="settings-foot">
                  <button className="secondary" onClick={() => setShareDialog(false)}>Отмена</button>
                  <button className="primary" onClick={startScreen}>Начать показ</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
