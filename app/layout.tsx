import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "MeetSpace — видеоконференции",
  description: "Простые видеоконференции в браузере"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",          // экран «в край» с учётом чёлки; отступы — через env(safe-area-*)
  interactiveWidget: "resizes-content", // экранная клавиатура уменьшает страницу, а не перекрывает чат
  themeColor: "#131314"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}