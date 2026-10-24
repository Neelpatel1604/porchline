import { NextRequest, NextResponse } from "next/server";

import { checkHostname } from "@/dns/check";
import { loadRootEnv } from "@/lib/env";

export async function POST(request: NextRequest) {
  loadRootEnv();
  const body = await request.json();
  const hostname = String(body.hostname || "");
  const target = String(body.cnameTarget || "");
  const parent = (process.env.PORCHLINE_PARENT_DOMAIN || "").trim().toLowerCase();
  if (!hostname || !target) {
    return NextResponse.json({ status: "error", message: "hostname and cnameTarget are required" }, { status: 400 });
  }
  if (parent && !hostname.endsWith(`.${parent}`)) {
    return NextResponse.json({ status: "error", message: "hostname is outside the parent domain" }, { status: 400 });
  }
  const dnsStatus = await checkHostname(hostname, target);
  return NextResponse.json({ hostname, cnameTarget: target, dnsStatus });
}
