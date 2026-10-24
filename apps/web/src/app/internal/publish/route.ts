import { NextRequest, NextResponse } from "next/server";

import { loadRootEnv } from "@/lib/env";
import { publishProfile } from "@/publish/run";

export async function POST(request: NextRequest) {
  loadRootEnv();
  const secret = process.env.INTERNAL_SHARED_SECRET || "";
  if (!secret || request.headers.get("x-porchline-secret") !== secret) {
    return NextResponse.json({ status: "error", message: "bad secret" }, { status: 401 });
  }
  const body = await request.json();
  const result = await publishProfile({
    projectId: String(body.projectId || ""),
    profile: body.profile,
    netlifySiteId: body.netlifySiteId ?? null,
    notifyVoice: true,
  });
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
