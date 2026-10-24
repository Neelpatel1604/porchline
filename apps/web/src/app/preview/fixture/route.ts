import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { renderSite } from "@/generator/render";
import { repoRoot } from "@/lib/env";
import { profileSchema } from "@/lib/profile";

export function GET() {
  const fixturePath = path.join(repoRoot(), "fixtures", "rose-barber.json");
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: parsed.error.issues.map((issue) => issue.message).join(", ") },
      { status: 400 },
    );
  }
  const site = renderSite(parsed.data);
  const html = site.html.replace('href="./styles.css"', `href="/preview/fixture/styles"`);
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
