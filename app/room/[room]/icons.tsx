import type { ReactNode } from "react";

export type IconName =
  | "mic" | "micOff" | "video" | "videoOff" | "screen" | "hand" | "chat"
  | "settings" | "phone" | "people" | "player" | "volume" | "volumeOff" | "fullscreen" | "fullscreenExit" | "board" | "pin" | "flip" | "copy" | "close" | "send" | "check";

/** Сдвиги, выравнивающие рисунок каждой иконки по центру рамки 24×24 (считаны по реальным границам). */
const NUDGE: Partial<Record<IconName, [number, number]>> = { screen: [0, -0.5], hand: [0.6, -0.25], chat: [0, 0.75], phone: [0.38, -0.38], people: [0, -0.25], volume: [-0.74, 0], volumeOff: [-0.75, 0], board: [0, -0.5], pin: [0, -0.5], copy: [0.25, 0.25], check: [0, -0.25] };

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const, "aria-hidden": true
  };
  const paths: Record<IconName, ReactNode> = {
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    micOff: <><path d="M5 5l14 14" /><path d="M15 9V6a3 3 0 0 0-5.5-1.6M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.7 5.1M12 18v3M8 21h8" /></>,
    video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></>,
    videoOff: <path d="M3 6h10a2 2 0 0 1 2 2v1M15 15v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M16 10l5-3v10l-5-3zM3 3l18 18" />,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M12 14V9M9.5 11.5 12 9l2.5 2.5" /></>,
    hand: <path d="M7 12V7a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v5c0 5-2.7 7-6.5 7h-1C9 21 7 18.5 5.5 16L4 13.5a1.5 1.5 0 0 1 2.6-1.5L8 14" />,
    chat: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.5 8.5 0 0 1-4-.9L4 19l.9-3.8A7.3 7.3 0 0 1 4.5 11 7.5 7.5 0 0 1 12 3.5a7.5 7.5 0 0 1 8 8Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    settings: <><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="4" /></>,
    phone: <path d="M6.6 3.5 9 5.9c.5.5.6 1.2.3 1.8L8 10.1a14.7 14.7 0 0 0 5.9 5.9l2.4-1.3c.6-.3 1.3-.2 1.8.3l2.4 2.4c.6.6.6 1.5 0 2.1l-1.4 1.4c-.7.7-1.7 1-2.7.7C8.6 19.4 4.6 15.4 2.4 7.6c-.3-1 0-2 .7-2.7l1.4-1.4c.6-.6 1.5-.6 2.1 0Z" />,
    people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17.3" cy="9" r="2.5" /><path d="M17.5 14c2.7.1 4 1.9 4 4.5" /></>,
    player: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10.5 9.5 4 2.5-4 2.5z" /></>,
    volume: <><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
    volumeOff: <><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z" /><path d="m16.5 9.5 5 5M21.5 9.5l-5 5" /></>,
    fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    fullscreenExit: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
    board: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="m7 13 3-3 2.5 2.5L17 8M9 21l1.5-4M15 21l-1.5-4" /></>,
    pin: <path d="M12 16.5V22M8.5 3h7l-1 6 3 3.5V14h-11v-1.5L9.5 9z" />,
    flip: <><path d="M4 12a8 8 0 0 1 13.5-5.8L20 8.5M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.5 5.8L4 15.5M4 20v-4.5h4.5" /></>,
    copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    send: <path d="M4 12 20 4l-6 16-3-7zM11 13l9-9" />,
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />
  };
  const [dx, dy] = NUDGE[name] ?? [0, 0];
  return <svg {...common}>{dx || dy ? <g transform={`translate(${dx} ${dy})`}>{paths[name]}</g> : paths[name]}</svg>;
}
