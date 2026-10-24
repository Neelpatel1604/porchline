import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { repoRoot } from "@/lib/env";
import { publishProfile } from "@/publish/run";

export async function POST() {
  const fixturePath = path.join(repoRoot(), "fixtures", "rose-barber.json");
  const memoryPath = path.join(repoRoot(), "data", "fixture-deploy.json");
  const profile = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  let memory: { netlifySiteId?: string; cloudflareRecordId?: string } = {};
  if (fs.existsSync(memoryPath)) {
    memory = JSON.parse(fs.readFileSync(memoryPath, "utf8"));
  }
  const result = await publishProfile({
    projectId: "fixture-rose-barber",
    profile,
    netlifySiteId: memory.netlifySiteId ?? null,
    cloudflareRecordId: memory.cloudflareRecordId ?? null,
  });
  if (result.status === "deployed") {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(
      memoryPath,
      JSON.stringify(
        {
          netlifySiteId: result.netlifySiteId,
          cloudflareRecordId: result.cloudflareRecordId,
        },
        null,
        2,
      ),
    );
  }
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
