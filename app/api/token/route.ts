import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const room = String(body.room || "").trim();
    const name = String(body.name || "").trim().slice(0, 60);

    if (!room || !name) {
      return NextResponse.json({ error: "Нужны room и name" }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json({ error: "LiveKit не настроен. Заполните .env.local" }, { status: 500 });
    }

    const identity = `${name}-${crypto.randomUUID().slice(0, 8)}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name
    });

    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    return NextResponse.json({
      token: await token.toJwt(),
      url: livekitUrl,
      identity,
      name
    });
  } catch {
    return NextResponse.json({ error: "Не удалось создать токен" }, { status: 500 });
  }
}