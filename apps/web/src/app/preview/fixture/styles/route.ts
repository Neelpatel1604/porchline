import { NextResponse } from "next/server";

import { renderSite } from "@/generator/render";
import { profileSchema } from "@/lib/profile";
import fs from "fs";
import path from "path";
import { repoRoot } from "@/lib/env";

export function GET() {
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot(), "fixtures", "rose-barber.json"), "utf8"));
  const parsed = profileSchema.parse(raw);
  const css = renderSite(parsed).css;
  return new NextResponse(css, { headers: { "Content-Type": "text/css; charset=utf-8" } });
}
