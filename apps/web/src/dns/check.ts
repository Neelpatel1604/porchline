import { Resolver } from "dns/promises";

export type DnsStatus = "not_found" | "mismatch" | "matches" | "https_ready";

function clean(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export async function checkHostname(hostname: string, expectedTarget: string): Promise<DnsStatus> {
  const resolver = new Resolver();
  let records: string[];
  try {
    records = await resolver.resolveCname(hostname);
  } catch {
    return "not_found";
  }
  const expected = clean(expectedTarget);
  const matched = records.some((record) => clean(record) === expected);
  if (!matched) return "mismatch";

  try {
    const response = await fetch(`https://${hostname}`, { method: "HEAD", redirect: "follow" });
    if (response.ok || response.status < 500) return "https_ready";
  } catch {
    return "matches";
  }
  return "matches";
}
