"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TranscriptLine = { role: string; text: string; at: string };

type Project = {
  id: string;
  callerId: string;
  status: string;
  profile: {
    businessName?: string;
    category?: string;
    summary?: string;
    phone?: string;
    email?: string | null;
    address?: string | null;
    serviceArea?: string | null;
    hours?: Record<string, { closed: boolean; open?: string | null; close?: string | null }>;
    services?: { name: string; priceLabel?: string | null }[];
    highlight?: string | null;
    vibe?: string | null;
    look?: string | null;
    heroLine?: string | null;
    audience?: string | null;
    siteSlug?: string;
    confirmed?: boolean;
  };
  transcript: TranscriptLine[];
  previewUrl?: string | null;
  hostname?: string | null;
  error?: string | null;
  callStartedAt?: string | null;
  callEndedAt?: string | null;
  updatedAt?: string | null;
};

type FixtureResult = {
  status: string;
  message?: string;
  previewUrl?: string;
  hostname?: string;
  builderSource?: "gemini" | "template";
  builderNote?: string;
};

const LIVE_IDLE_MS = 90_000;
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function isCallLive(project: Project | null, now: number): boolean {
  if (!project?.callStartedAt || project.callEndedAt) return false;
  const stamp = Date.parse(project.updatedAt || project.callStartedAt);
  if (!Number.isFinite(stamp)) return false;
  return now - stamp < LIVE_IDLE_MS;
}

function statusLabel(project: Project | null, live: boolean, elapsed: string | null): string {
  if (!project) return "Waiting for a call";
  if (live && elapsed) return `Live · ${elapsed}`;
  if (project.status === "designing") return "Designing site";
  if (project.status === "deploying") return "Publishing";
  if (project.status === "deployed") return "Published";
  if (project.status === "error") return "Error";
  return "No live call";
}

function formatHours(project: Project): string {
  const hours = project.profile.hours;
  if (!hours) return "—";
  const parts = DAYS.filter((day) => hours[day]).map((day) => {
    const value = hours[day];
    const label = value?.closed || !value?.open ? "Closed" : `${value.open}–${value.close}`;
    return `${day.slice(0, 3)} ${label}`;
  });
  return parts.length ? parts.join(" · ") : "—";
}

function roleLabel(role: string): string {
  const value = role.toLowerCase();
  if (value === "owner" || value === "user") return "Owner";
  if (value === "agent" || value === "assistant") return "Agent";
  return role;
}

function isOwner(role: string): boolean {
  const value = role.toLowerCase();
  return value === "owner" || value === "user";
}

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-0">
      <dt className="text-[0.7rem] uppercase tracking-[0.16em] text-amber-200/70">{label}</dt>
      <dd className="mt-1 text-base text-white/95">{value}</dd>
    </div>
  );
}

function TranscriptBubbles({ lines, follow }: { lines: TranscriptLine[]; follow?: boolean }) {
  return (
    <>
      {lines.map((line, index) => {
        const owner = isOwner(line.role);
        return (
          <div
            key={`${line.at}-${index}`}
            className={`flex ${owner ? "justify-end" : "justify-start"} ${follow ? "animate-in" : ""}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                owner ? "bg-amber-400 text-[#1a1208]" : "bg-white/8 text-white ring-1 ring-white/10"
              }`}
            >
              <p
                className={`text-[0.68rem] font-semibold uppercase tracking-[0.14em] ${
                  owner ? "text-[#5c3b10]" : "text-amber-200/80"
                }`}
              >
                {roleLabel(line.role)}
              </p>
              <p className="mt-1 text-[1.05rem] leading-snug">{line.text}</p>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function Dashboard({ voiceBaseUrl }: { voiceBaseUrl: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [fixture, setFixture] = useState<FixtureResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Project[]>([]);
  const [historySelected, setHistorySelected] = useState<Project | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [followLatest, setFollowLatest] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    let currentId: string | null = null;

    function openStream(projectId: string) {
      source?.close();
      source = new EventSource(`${voiceBaseUrl}/projects/${projectId}/stream`);
      source.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { project?: Project };
        if (payload.project) setProject(payload.project);
      };
      source.onerror = () =>
        setVoiceError("We're having trouble keeping the live stage in sync. We'll be right back.");
    }

    async function load() {
      try {
        const response = await fetch(`${voiceBaseUrl}/projects/current`);
        if (!response.ok) throw new Error(`Voice service returned ${response.status}`);
        const body = (await response.json()) as { project: Project | null };
        if (cancelled) return;
        setVoiceError(null);
        setProject(body.project);
        if (body.project && body.project.id !== currentId) {
          currentId = body.project.id;
          openStream(body.project.id);
          setFollowLatest(true);
        }
      } catch {
        if (!cancelled) {
          setVoiceError("We're facing a temporary issue with the live stage. We'll be right back.");
        }
      }
    }

    void load();
    const poll = setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      source?.close();
    };
  }, [voiceBaseUrl]);

  const live = isCallLive(project, now);

  const elapsed = useMemo(() => {
    if (!live || !project?.callStartedAt) return null;
    const seconds = Math.max(0, Math.floor((now - Date.parse(project.callStartedAt)) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }, [live, now, project?.callStartedAt]);

  useEffect(() => {
    if (!followLatest) return;
    const pane = transcriptPaneRef.current;
    if (!pane) return;
    pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  }, [followLatest, project?.transcript.length, project?.id]);

  function onTranscriptScroll() {
    const pane = transcriptPaneRef.current;
    if (!pane) return;
    const distance = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
    setFollowLatest(distance < 72);
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistorySelected(null);
    try {
      const response = await fetch(`${voiceBaseUrl}/projects`);
      const body = (await response.json()) as { projects: Project[] };
      setHistory(body.projects || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function selectHistory(id: string) {
    setHistoryLoading(true);
    try {
      const response = await fetch(`${voiceBaseUrl}/projects/${id}`);
      const body = (await response.json()) as { project: Project };
      setHistorySelected(body.project);
    } catch {
      setHistorySelected(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deployFixture() {
    setBusy("Designing and publishing the Rose Street Barber fixture…");
    setFixture(null);
    const response = await fetch("/api/deploy-fixture", { method: "POST" });
    const body = (await response.json()) as FixtureResult;
    setFixture(body);
    setBusy(null);
  }

  async function cancelPublish() {
    if (!project) return;
    await fetch(`${voiceBaseUrl}/projects/${project.id}/cancel`, { method: "POST" });
  }

  const inFlight = project?.status === "designing" || project?.status === "deploying";
  const showCallData = live || inFlight;
  const preview = fixture?.previewUrl || (showCallData ? project?.previewUrl : null);
  const hostname = fixture?.hostname || (showCallData ? project?.hostname : null);
  const lines = showCallData ? (project?.transcript ?? []) : [];
  const stageStatus = statusLabel(showCallData ? project : null, live, elapsed);

  return (
    <main className="stage-shell min-h-screen px-4 py-6 text-white md:px-8 md:py-8">
      <header className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-6">
        <div>
          <p className="font-display text-5xl tracking-tight md:text-6xl">Porchline</p>
          <p className="mt-2 max-w-xl text-base text-white/65">
            Live operator stage — watch the call, the saved facts, and the site as they land.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              live ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-300/40" : "bg-white/10 text-white/70"
            }`}
          >
            {live ? <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" /> : null}
            {stageStatus}
          </div>
          <button
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
            onClick={() => void openHistory()}
            type="button"
          >
            History
          </button>
          <a className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/5" href="/dev/call">
            Dev mic
          </a>
        </div>
      </header>

      {voiceError ? (
        <p className="mx-auto mt-5 max-w-7xl rounded-2xl bg-rose-500/15 px-4 py-3 text-sm text-rose-100 ring-1 ring-rose-400/30">
          {voiceError}
        </p>
      ) : null}
      {busy ? <p className="mx-auto mt-5 max-w-7xl text-sm text-amber-200">{busy}</p> : null}

      <section className="mx-auto mt-6 grid max-w-7xl gap-5 lg:grid-cols-[1.35fr_0.9fr] lg:items-stretch">
        <article className="flex h-[min(70vh,40rem)] flex-col overflow-hidden rounded-3xl bg-[#171a22]/90 ring-1 ring-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="font-display text-2xl tracking-tight">Live transcript</h2>
              <p className="text-sm text-white/50">
                {showCallData
                  ? followLatest
                    ? "Following the latest line — scroll up to pause"
                    : "Scroll follow paused — jump to bottom to resume"
                  : "Appears when a call is in progress"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {showCallData ? <p className="text-sm text-white/45">{lines.length} lines</p> : null}
              {showCallData && !followLatest ? (
                <button
                  className="rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-[#1a1208]"
                  onClick={() => setFollowLatest(true)}
                  type="button"
                >
                  Jump to latest
                </button>
              ) : null}
            </div>
          </div>
          <div
            ref={transcriptPaneRef}
            onScroll={onTranscriptScroll}
            className="panel-scroll flex-1 space-y-3 overflow-y-auto px-5 py-5"
          >
            {showCallData && lines.length ? (
              <>
                <TranscriptBubbles lines={lines} follow={followLatest} />
                <div ref={transcriptEndRef} />
              </>
            ) : (
              <div className="flex h-full min-h-[16rem] items-center justify-center text-center text-white/45">
                <p>
                  {live ? "Waiting for speech…" : "Waiting for a call"}
                  <br />
                  <span className="text-sm">
                    {live
                      ? "Owner and agent lines appear here live."
                      : "The stage stays clear until someone dials in."}
                  </span>
                </p>
              </div>
            )}
          </div>
        </article>

        <article className="flex h-[min(70vh,40rem)] flex-col overflow-hidden rounded-3xl bg-gradient-to-b from-[#222733] to-[#151820] ring-1 ring-white/10">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="font-display text-2xl tracking-tight">Saved profile</h2>
              <p className="text-sm text-white/50">
                {showCallData ? "Facts written by tools this call" : "Fills in during the live call"}
              </p>
            </div>
            {showCallData && project?.callerId ? (
              <p className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/60">{project.callerId}</p>
            ) : null}
          </div>

          <div className="panel-scroll flex-1 overflow-y-auto px-5 py-2">
            {showCallData && project ? (
              <dl>
                <Fact label="Business" value={project.profile.businessName || "—"} />
                <Fact
                  label="Category"
                  value={project.profile.category ? project.profile.category.replaceAll("_", " ") : "—"}
                />
                <Fact label="Summary" value={project.profile.summary || "—"} />
                <Fact label="Phone" value={project.profile.phone || "—"} />
                <Fact label="Hours" value={formatHours(project)} />
                <Fact
                  label="Services"
                  value={
                    project.profile.services?.length
                      ? project.profile.services.map((service) => service.name).join(", ")
                      : "—"
                  }
                />
                <Fact
                  label="Style"
                  value={
                    [project.profile.vibe, project.profile.look, project.profile.heroLine, project.profile.audience]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
              </dl>
            ) : (
              <p className="mt-8 text-sm text-white/50">Place a call to start filling this card.</p>
            )}

            {showCallData && project?.error ? <p className="mt-3 text-sm text-rose-300">{project.error}</p> : null}
            {inFlight && project ? (
              <div className="mt-4 space-y-3 rounded-2xl bg-amber-400/10 p-4 ring-1 ring-amber-300/20">
                <p className="text-sm text-amber-100">
                  {project.status === "designing"
                    ? "Gemini is designing the site, then Netlify will publish it."
                    : "Publishing to Netlify…"}
                </p>
                <button
                  className="rounded-full border border-amber-200/40 px-4 py-2 text-sm text-amber-50"
                  onClick={cancelPublish}
                  type="button"
                >
                  Cancel publish
                </button>
              </div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="mx-auto mt-5 flex max-w-7xl flex-wrap items-center justify-between gap-4 rounded-3xl bg-white/[0.04] px-5 py-4 ring-1 ring-white/10">
        <div>
          <h2 className="font-display text-xl">Published site</h2>
          <p className="text-sm text-white/50">
            {preview ? "Open the live Netlify link." : "Publish from a call, or deploy the fixture for a dry run."}
          </p>
          {hostname ? <p className="mt-1 text-xs text-white/40">{hostname}</p> : null}
          {fixture?.builderSource ? (
            <p className="mt-1 text-xs text-white/40">Builder: {fixture.builderSource}</p>
          ) : null}
          {fixture?.message || fixture?.builderNote ? (
            <p className="mt-2 text-sm text-rose-300">{fixture.message || fixture.builderNote}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {preview ? (
            <a
              className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-semibold text-[#1a1208] hover:bg-amber-300"
              href={preview}
              target="_blank"
              rel="noreferrer"
            >
              Open live site
            </a>
          ) : null}
          <button
            className="rounded-full border border-white/20 px-5 py-2.5 text-sm text-white/85 hover:bg-white/5"
            onClick={deployFixture}
            type="button"
          >
            Deploy fixture
          </button>
        </div>
      </section>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/55 p-3 backdrop-blur-sm md:p-6">
          <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-[#12151d] ring-1 ring-white/15 shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="font-display text-3xl tracking-tight">History</h2>
                <p className="text-sm text-white/50">Past calls, transcripts, and saved profiles</p>
              </div>
              <button
                className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
                onClick={() => setHistoryOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[0.9fr_1.2fr]">
              <div className="panel-scroll overflow-y-auto border-b border-white/10 md:border-b-0 md:border-r">
                {historyLoading && !history.length ? (
                  <p className="p-5 text-sm text-white/50">Loading…</p>
                ) : history.length ? (
                  <ul className="divide-y divide-white/10">
                    {history.map((item) => {
                      const title = item.profile.businessName || item.callerId || "Untitled call";
                      const active = historySelected?.id === item.id;
                      return (
                        <li key={item.id}>
                          <button
                            className={`w-full px-5 py-4 text-left hover:bg-white/5 ${active ? "bg-white/8" : ""}`}
                            onClick={() => void selectHistory(item.id)}
                            type="button"
                          >
                            <p className="font-medium text-white">{title}</p>
                            <p className="mt-1 text-xs text-white/45">
                              {formatWhen(item.callStartedAt || item.updatedAt)} · {item.status} ·{" "}
                              {item.transcript?.length || 0} lines
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="p-5 text-sm text-white/50">No past calls yet.</p>
                )}
              </div>
              <div className="panel-scroll overflow-y-auto p-5">
                {historySelected ? (
                  <div className="space-y-6">
                    <div>
                      <p className="text-[0.7rem] uppercase tracking-[0.16em] text-amber-200/70">Caller</p>
                      <p className="mt-1 text-lg">{historySelected.callerId}</p>
                      <p className="mt-1 text-sm text-white/45">
                        {formatWhen(historySelected.callStartedAt)} · {historySelected.status}
                      </p>
                      {historySelected.previewUrl ? (
                        <a
                          className="mt-3 inline-flex rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-[#1a1208]"
                          href={historySelected.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open site
                        </a>
                      ) : null}
                    </div>
                    <div>
                      <h3 className="font-display text-xl">Profile</h3>
                      <dl className="mt-2">
                        <Fact label="Business" value={historySelected.profile.businessName || "—"} />
                        <Fact label="Summary" value={historySelected.profile.summary || "—"} />
                        <Fact label="Phone" value={historySelected.profile.phone || "—"} />
                        <Fact label="Hours" value={formatHours(historySelected)} />
                      </dl>
                    </div>
                    <div>
                      <h3 className="font-display text-xl">Transcript</h3>
                      <div className="mt-3 space-y-3">
                        {historySelected.transcript?.length ? (
                          <TranscriptBubbles lines={historySelected.transcript} />
                        ) : (
                          <p className="text-sm text-white/50">No transcript saved for this call.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-white/50">Select a past call to review it.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
