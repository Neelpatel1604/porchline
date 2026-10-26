import { DirectoryView } from "@/app/directory-panel";
import { StageNav } from "@/app/stage-nav";
import { resolveVoiceBaseUrl } from "@/lib/voice-url";

export const dynamic = "force-dynamic";

export default function DirectoryPage() {
  const voiceBaseUrl = resolveVoiceBaseUrl();
  return (
    <main className="stage-shell flex h-dvh flex-col overflow-hidden px-4 py-4 text-white md:px-8 md:py-5">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
        <StageNav />
        <DirectoryView voiceBaseUrl={voiceBaseUrl} />
      </div>
    </main>
  );
}
