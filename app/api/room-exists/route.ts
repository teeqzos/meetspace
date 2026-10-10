import { RoomServiceClient } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

function httpUrl(url: string) {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get("room")?.trim();

  if (!room) {
    return NextResponse.json({ exists: false, error: "Не указан ID комнаты" }, { status: 400 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json({ exists: false, error: "LiveKit не настроен" }, { status: 500 });
  }

  try {
    const service = new RoomServiceClient(httpUrl(livekitUrl), apiKey, apiSecret);
    const rooms = await service.listRooms([room]);
    const active = rooms.find((item) => item.name === room && item.numParticipants > 0);

    return NextResponse.json({
      exists: Boolean(active),
      participants: active?.numParticipants ?? 0
    });
  } catch {
    return NextResponse.json({ exists: false, error: "Не удалось проверить комнату" }, { status: 502 });
  }
}
