import fs from "fs";
import os from "os";
import path from "path";

import { deployFiles, ensureSite, netlifyHost } from "@/deploy/netlify";
import { loadRootEnv, missingEnv, repoRoot } from "@/lib/env";
import { buildSite } from "@/generator/aiSite";
import { ensurePublishDefaults, profileSchema, type Profile } from "@/lib/profile";

export type PublishResult = {
  status: "deployed" | "error";
  projectId: string;
  message?: string;
  previewUrl?: string;
  hostname?: string;
  netlifySiteId?: string;
  builderSource?: "gemini" | "template";
  builderNote?: string;
};

function siteDir(projectId: string): string {
  // Netlify / serverless filesystems are read-only except tmp — never write into the deploy bundle.
  const onNetlify = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const root = onNetlify ? path.join(os.tmpdir(), "porchline-sites") : path.join(repoRoot(), "data", "sites");
  return path.join(root, projectId);
}

function writeBundle(projectId: string, html: string, css: string, js?: string): void {
  try {
    const dir = siteDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    fs.writeFileSync(path.join(dir, "styles.css"), css, "utf8");
    if (js?.trim()) fs.writeFileSync(path.join(dir, "script.js"), js, "utf8");
  } catch (error) {
    // Local cache only — Netlify deploy uses the in-memory bundle either way.
    console.warn("site bundle cache skipped:", error);
  }
}

export async function publishProfile(input: {
  projectId: string;
  profile: unknown;
  netlifySiteId?: string | null;
  notifyVoice?: boolean;
}): Promise<PublishResult> {
  loadRootEnv();
  const rawProfile =
    input.profile && typeof input.profile === "object"
      ? (() => {
          const copy = { ...(input.profile as Record<string, unknown>) };
          if (!copy.siteSlug && typeof copy.subdomainLabel === "string") {
            copy.siteSlug = copy.subdomainLabel;
          }
          delete copy.subdomainLabel;
          return copy;
        })()
      : input.profile;
  const parsed = profileSchema.safeParse(rawProfile);
  if (!parsed.success) {
    return {
      status: "error",
      projectId: input.projectId,
      message: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", "),
    };
  }
  if (!String(parsed.data.businessName || "").trim()) {
    return {
      status: "error",
      projectId: input.projectId,
      message: "businessName is required before publish",
    };
  }
  const profile: Profile = ensurePublishDefaults(parsed.data);
  const missing = missingEnv(["NETLIFY_AUTH_TOKEN"]);
  if (missing) {
    return { status: "error", projectId: input.projectId, message: missing };
  }

  const token = process.env.NETLIFY_AUTH_TOKEN!.trim();

  try {
    const rendered = await buildSite(profile);
    writeBundle(input.projectId, rendered.html, rendered.css, rendered.js);
    const siteName = `porchline-${profile.siteSlug}`.slice(0, 50);
    const site = await ensureSite(token, input.netlifySiteId ?? null, siteName);
    await deployFiles(token, site.id, rendered);
    const hostname = netlifyHost(site);
    const previewUrl = site.ssl_url || `https://${hostname}`;
    const result: PublishResult = {
      status: "deployed",
      projectId: input.projectId,
      previewUrl,
      hostname,
      netlifySiteId: site.id,
      builderSource: rendered.source,
      builderNote: rendered.note,
      message: rendered.note,
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
