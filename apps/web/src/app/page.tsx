import { Dashboard } from "@/app/dashboard";
import { loadRootEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function resolveVoiceBaseUrl(): string {
  // Prefer Netlify/runtime env. Never ship localhost to production builds.
  const configured = (process.env.VOICE_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured && !configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured;
  }
  if (process.env.NODE_ENV !== "production") {
    loadRootEnv();
    const local = (process.env.VOICE_BASE_URL || "").trim().replace(/\/$/, "");
    return local || "http://localhost:8000";
  }
  // Production misconfig — show a clear host instead of silently using localhost.
  return configured || "https://VOICE_BASE_URL-not-set";
}

export default function HomePage() {
  return <Dashboard voiceBaseUrl={resolveVoiceBaseUrl()} />;
}
