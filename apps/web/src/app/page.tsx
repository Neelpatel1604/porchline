import { Dashboard } from "@/app/dashboard";
import { loadRootEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  loadRootEnv();
  return <Dashboard voiceBaseUrl={process.env.VOICE_BASE_URL || "http://localhost:8000"} />;
}
