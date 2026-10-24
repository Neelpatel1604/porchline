import JSZip from "jszip";

type NetlifySite = {
  id: string;
  name: string;
  ssl_url?: string;
  url?: string;
  default_domain?: string;
};

function authHeaders(token: string, json = true): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 400) || `HTTP ${response.status}`;
}

export async function ensureSite(token: string, siteId: string | null, siteName: string): Promise<NetlifySite> {
  if (siteId) {
    const existing = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
      headers: authHeaders(token),
    });
    if (existing.ok) return (await existing.json()) as NetlifySite;
  }

  const attempts = [
    siteName.slice(0, 50),
    `${siteName}`.slice(0, 42) + `-${Date.now().toString(36).slice(-6)}`,
  ];
  let lastError = "unknown";
  for (const name of attempts) {
    const created = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name }),
    });
    if (created.ok) return (await created.json()) as NetlifySite;
    lastError = await readError(created);
    if (!lastError.includes("must be unique")) {
      throw new Error(`Netlify site create failed: ${lastError}`);
    }
  }
  throw new Error(`Netlify site create failed: ${lastError}`);
}

export function netlifyHost(site: NetlifySite): string {
  if (site.default_domain) return site.default_domain;
  if (site.ssl_url) return new URL(site.ssl_url).host;
  if (site.url) return new URL(site.url).host;
  return `${site.name}.netlify.app`;
}

export async function deployFiles(
  token: string,
  siteId: string,
  files: { html: string; css: string; js?: string },
): Promise<void> {
  const zip = new JSZip();
  zip.file("index.html", files.html);
  zip.file("styles.css", files.css);
  if (files.js?.trim()) zip.file("script.js", files.js);
  const body = await zip.generateAsync({ type: "uint8array" });
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/zip",
    },
    body: Buffer.from(body),
  });
  if (!response.ok) {
    throw new Error(`Netlify deploy failed: ${await readError(response)}`);
  }
}

