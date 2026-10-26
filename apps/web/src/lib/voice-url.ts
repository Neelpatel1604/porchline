import { loadRootEnv } from "@/lib/env";

export function resolveVoiceBaseUrl(): string {
  const configured = (process.env.VOICE_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured && !configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured;
  }
  if (process.env.NODE_ENV !== "production") {
    loadRootEnv();
    const local = (process.env.VOICE_BASE_URL || "").trim().replace(/\/$/, "");
    return local || "http://localhost:8000";
  }
  return configured || "https://VOICE_BASE_URL-not-set";
}
