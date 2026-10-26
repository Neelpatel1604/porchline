import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { loadRootEnv, repoRoot } from "@/lib/env";

export async function POST() {
  loadRootEnv();
  const fixturePath = path.join(repoRoot(), "fixtures", "rose-barber.json");
  const memoryPath = path.join(repoRoot(), "data", "fixture-deploy.json");
  const profile = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  let memory: { netlifySiteId?: string } = {};
  if (fs.existsSync(memoryPath)) {
    memory = JSON.parse(fs.readFileSync(memoryPath, "utf8"));
  }

  const voiceBase = (process.env.VOICE_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const secret = process.env.INTERNAL_SHARED_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { status: "error", message: "Missing INTERNAL_SHARED_SECRET" },
      { status: 500 },
    );
  }

  // Publish runs on the voice host (EC2) — Gemini needs longer than Netlify functions allow.
  const response = await fetch(`${voiceBase}/internal/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Porchline-Secret": secret,
    },
    body: JSON.stringify({
      projectId: "fixture-rose-barber",
      profile,
      netlifySiteId: memory.netlifySiteId ?? null,
    }),
  });
  const result = (await response.json().catch(() => ({
    status: "error",
    message: `Publish returned HTTP ${response.status}`,
  }))) as {
    status: string;
    message?: string;
    netlifySiteId?: string;
    previewUrl?: string;
    hostname?: string;
    builderSource?: string;
    builderNote?: string;
  };

  if (result.status === "deployed" && result.netlifySiteId) {
    try {
      fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
      fs.writeFileSync(
        memoryPath,
        JSON.stringify({ netlifySiteId: result.netlifySiteId }, null, 2),
      );
    } catch {
      // Netlify FS may be read-only; deploy still succeeded.
    }
  }
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
