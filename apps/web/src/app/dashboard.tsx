"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { StageNav } from "./stage-nav";

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

/** Safety net only — real hangup should set callEndedAt via Twilio connect-ended / disconnect. */
const LIVE_IDLE_MS = 20_000;
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
  if (value === "save" || value === "system") return "Saved to DB";
  return role;
}

function isOwner(role: string): boolean {
  const value = role.toLowerCase();
  return value === "owner" || value === "user";
}

function isSaveNote(role: string): boolean {
  const value = role.toLowerCase();
  return value === "save" || value === "system";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-0">
      <dt className="text-[0.7rem] uppercase tracking-[0.16em] text-amber-200">{label}</dt>
      <dd className="mt-1 text-base pl-text">{value}</dd>
    </div>
  );
}

function TranscriptBubbles({ lines, follow }: { lines: TranscriptLine[]; follow?: boolean }) {
  return (
    <>
      {lines.map((line, index) => {
        const owner = isOwner(line.role);
        const saved = isSaveNote(line.role);
        return (
          <div
            key={`${line.at}-${index}`}
            className={`flex ${owner ? "justify-end" : "justify-start"} ${follow ? "animate-in" : ""}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                saved
                  ? "bg-emerald-500/15 text-emerald-50 ring-1 ring-emerald-300/30"
                  : owner
                    ? "bg-amber-400 text-[#1a1208]"
                    : "bg-white/8 text-white ring-1 ring-white/10"
              }`}
            >
              <p
                className={`text-[0.68rem] font-semibold uppercase tracking-[0.14em] ${
                  saved ? "text-emerald-200/90" : owner ? "text-[#5c3b10]" : "text-amber-200/80"
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
  const [now, setNow] = useState(Date.now());
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

  async function cancelPublish() {
    if (!project) return;
    await fetch(`${voiceBaseUrl}/projects/${project.id}/cancel`, { method: "POST" });
  }

  const inFlight = project?.status === "designing" || project?.status === "deploying";
  const showCallData = live || inFlight;
  const preview = showCallData ? project?.previewUrl : null;
  const lines = showCallData ? (project?.transcript ?? []) : [];
  const stageStatus = statusLabel(showCallData ? project : null, live, elapsed);

  return (
    <main className="stage-shell flex h-dvh flex-col overflow-hidden px-4 py-4 text-white md:px-8 md:py-5">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
        <StageNav status={stageStatus} live={live} />

        {voiceError ? (
          <p className="shrink-0 rounded-2xl bg-rose-500/20 px-4 py-3 text-sm text-rose-50 ring-1 ring-rose-300/35">
            {voiceError}
          </p>
        ) : null}

        <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.35fr_0.95fr]">
          <article className="pl-panel flex min-h-0 flex-col overflow-hidden rounded-3xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/12 px-5 py-3">
              <div>
                <h2 className="font-display text-xl tracking-tight pl-text">Live transcript</h2>
                <p className="text-sm pl-muted">
                  {showCallData
                    ? followLatest
                      ? "Following latest — green lines are DB saves"
                      : "Scroll follow paused"
                    : "Appears when a call is in progress"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {showCallData ? <p className="text-sm pl-subtle">{lines.length} lines</p> : null}
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
              className="panel-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
            >
              {showCallData && lines.length ? (
                <>
                  <TranscriptBubbles lines={lines} follow={followLatest} />
                  <div ref={transcriptEndRef} />
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-center pl-subtle">
                  <p>
                    {live ? "Waiting for speech…" : "Waiting for a call"}
                    <br />
                    <span className="text-sm pl-muted">
                      {live
                        ? "Owner and agent lines appear here live."
                        : "The stage stays clear until someone dials in."}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </article>

          <article className="pl-panel flex min-h-0 flex-col overflow-hidden rounded-3xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/12 px-5 py-3">
              <div>
                <h2 className="font-display text-xl tracking-tight pl-text">Saved profile</h2>
                <p className="text-sm pl-muted">
                  {showCallData ? "Facts written by tools this call" : "Fills in during the live call"}
                </p>
              </div>
              {showCallData && project?.callerId ? (
                <p className="rounded-full bg-white/10 px-3 py-1 text-xs pl-muted">{project.callerId}</p>
              ) : null}
            </div>

            <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-2">
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
                <p className="mt-6 text-sm pl-muted">Place a call to start filling this card.</p>
              )}

              {showCallData && project?.error ? <p className="mt-3 text-sm text-rose-200">{project.error}</p> : null}
              {preview ? (
                <a
                  className="mt-4 inline-flex rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-[#1a1208] hover:bg-amber-300"
                  href={preview}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open site
                </a>
              ) : null}
              {inFlight && project ? (
                <div className="mt-4 space-y-3 rounded-2xl bg-amber-400/15 p-4 ring-1 ring-amber-300/30">
                  <p className="text-sm text-amber-50">
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
      </div>
    </main>
  );
}
