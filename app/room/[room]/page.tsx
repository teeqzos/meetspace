import RoomClient from "./room-client";

export default async function RoomPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <RoomClient room={decodeURIComponent(room)} />;
}