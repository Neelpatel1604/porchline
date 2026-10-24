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

  const created = await fetch("https://api.netlify.com/api/v1/sites", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name: siteName }),
  });
  if (!created.ok) {
    throw new Error(`Netlify site create failed: ${await readError(created)}`);
  }
  return (await created.json()) as NetlifySite;
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
  files: { html: string; css: string },
): Promise<void> {
  const zip = new JSZip();
  zip.file("index.html", files.html);
  zip.file("styles.css", files.css);
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

export async function attachHostname(token: string, siteId: string, hostname: string): Promise<void> {
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ custom_domain: hostname }),
  });
  if (!response.ok) {
    throw new Error(`Netlify custom domain failed: ${await readError(response)}`);
  }
}
