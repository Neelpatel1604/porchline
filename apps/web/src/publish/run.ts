import fs from "fs";
import path from "path";

import { attachHostname, deployFiles, ensureSite, netlifyHost } from "@/deploy/netlify";
import { checkHostname, type DnsStatus } from "@/dns/check";
import { upsertCname } from "@/dns/cloudflare";
import { loadRootEnv, missingEnv, repoRoot } from "@/lib/env";
import { profileSchema, type Profile } from "@/lib/profile";
import { renderSite } from "@/generator/render";

export type PublishResult = {
  status: "deployed" | "error";
  projectId: string;
  message?: string;
  previewUrl?: string;
  hostname?: string;
  cnameTarget?: string;
  netlifySiteId?: string;
  cloudflareRecordId?: string | null;
  dnsStatus?: DnsStatus;
};

function siteDir(projectId: string): string {
  return path.join(repoRoot(), "data", "sites", projectId);
}

function writeBundle(projectId: string, html: string, css: string): void {
  const dir = siteDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(dir, "styles.css"), css, "utf8");
}

export async function publishProfile(input: {
  projectId: string;
  profile: unknown;
  netlifySiteId?: string | null;
  cloudflareRecordId?: string | null;
  notifyVoice?: boolean;
}): Promise<PublishResult> {
  loadRootEnv();
  const parsed = profileSchema.safeParse(input.profile);
  if (!parsed.success) {
    return {
      status: "error",
      projectId: input.projectId,
      message: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", "),
    };
  }
  const profile: Profile = parsed.data;
  const missing = missingEnv([
    "PORCHLINE_PARENT_DOMAIN",
    "NETLIFY_AUTH_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ZONE_ID",
  ]);
  if (missing) {
    return { status: "error", projectId: input.projectId, message: missing };
  }

  const parent = process.env.PORCHLINE_PARENT_DOMAIN!.trim().toLowerCase();
  const hostname = `${profile.subdomainLabel}.${parent}`;
  const token = process.env.NETLIFY_AUTH_TOKEN!.trim();
  const rendered = renderSite(profile);
  writeBundle(input.projectId, rendered.html, rendered.css);

  try {
    const siteName = `porchline-${profile.subdomainLabel}`.slice(0, 50);
    const site = await ensureSite(token, input.netlifySiteId ?? null, siteName);
    await deployFiles(token, site.id, rendered);
    await attachHostname(token, site.id, hostname);
    const target = netlifyHost(site);
    const record = await upsertCname({
      token: process.env.CLOUDFLARE_API_TOKEN!.trim(),
      zoneId: process.env.CLOUDFLARE_ZONE_ID!.trim(),
      hostname,
      target,
      recordId: input.cloudflareRecordId ?? null,
    });
    const dnsStatus = await checkHostname(hostname, target);
    const previewUrl = site.ssl_url || `https://${target}`;
    const result: PublishResult = {
      status: "deployed",
      projectId: input.projectId,
      previewUrl,
      hostname,
      cnameTarget: target,
      netlifySiteId: site.id,
      cloudflareRecordId: record.id,
      dnsStatus,
    };
    if (input.notifyVoice) await notifyVoice(result);
    return result;
  } catch (error) {
    const result: PublishResult = {
      status: "error",
      projectId: input.projectId,
      message: error instanceof Error ? error.message : "Publish failed",
    };
    if (input.notifyVoice) await notifyVoice(result);
    return result;
  }
}

async function notifyVoice(result: PublishResult): Promise<void> {
  const base = process.env.VOICE_BASE_URL || "http://localhost:8000";
  const secret = process.env.INTERNAL_SHARED_SECRET || "";
  if (!secret) return;
  try {
    await fetch(`${base.replace(/\/$/, "")}/internal/deploy-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Porchline-Secret": secret,
      },
      body: JSON.stringify(result),
    });
  } catch {
    // The voice service also reads the publish HTTP response.
  }
}
