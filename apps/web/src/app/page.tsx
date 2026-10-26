import { Dashboard } from "@/app/dashboard";
import { resolveVoiceBaseUrl } from "@/lib/voice-url";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <Dashboard voiceBaseUrl={resolveVoiceBaseUrl()} />;
}
