type CloudflareRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
};

type CloudflareList = {
  success: boolean;
  errors?: { message: string }[];
  result?: CloudflareRecord[];
};

type CloudflareOne = {
  success: boolean;
  errors?: { message: string }[];
  result?: CloudflareRecord;
};

function endpoint(zoneId: string, recordId?: string): string {
  const base = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
  return recordId ? `${base}/${recordId}` : base;
}

async function cloudflare<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as T & { success?: boolean; errors?: { message: string }[] };
  if (!response.ok || body.success === false) {
    const message = body.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    throw new Error(`Cloudflare DNS failed: ${message}`);
  }
  return body;
}

export async function upsertCname(input: {
  token: string;
  zoneId: string;
  hostname: string;
  target: string;
  recordId: string | null;
}): Promise<CloudflareRecord> {
  const payload = {
    type: "CNAME",
    name: input.hostname,
    content: input.target,
    proxied: false,
    ttl: 1,
  };

  let recordId = input.recordId;
  if (!recordId) {
    const listed = await cloudflare<CloudflareList>(
      input.token,
      `${endpoint(input.zoneId)}?type=CNAME&name=${encodeURIComponent(input.hostname)}`,
    );
    recordId = listed.result?.[0]?.id ?? null;
  }

  const saved = recordId
    ? await cloudflare<CloudflareOne>(input.token, endpoint(input.zoneId, recordId), {
        method: "PUT",
        body: JSON.stringify(payload),
      })
    : await cloudflare<CloudflareOne>(input.token, endpoint(input.zoneId), {
        method: "POST",
        body: JSON.stringify(payload),
      });

  const record = saved.result;
  if (!record) throw new Error("Cloudflare DNS failed: empty record");
  if (record.proxied) {
    throw new Error("Cloudflare record is proxied. Porchline requires DNS-only so Netlify can issue the certificate.");
  }
  return record;
}
