"use client";

import { useEffect, useMemo, useState } from "react";

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
    subdomainLabel?: string;
    confirmed?: boolean;
  };
  transcript: TranscriptLine[];
  previewUrl?: string | null;
  hostname?: string | null;
  cnameTarget?: string | null;
  error?: string | null;
  callStartedAt?: string | null;
  callEndedAt?: string | null;
};

type FixtureResult = {
  status: string;
  message?: string;
  previewUrl?: string;
  hostname?: string;
  cnameTarget?: string;
  dnsStatus?: string;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function formatHours(project: Project): string {
  const hours = project.profile.hours;
  if (!hours || DAYS.some((day) => !hours[day])) return "Not saved";
  return DAYS.map((day) => {
    const value = hours[day];
    const label = value?.closed || !value?.open ? "Closed" : `${value.open}–${value.close}`;
    return `${day.slice(0, 3)} ${label}`;
  }).join(" · ");
}

export function Dashboard({
  voiceBaseUrl,
  parentDomain,
}: {
  voiceBaseUrl: string;
  parentDomain: string;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [fixture, setFixture] = useState<FixtureResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

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
      source.onerror = () => setVoiceError("Live updates disconnected. They reconnect on the next refresh.");
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
        }
      } catch {
        if (!cancelled) setVoiceError("Voice service is not running on " + voiceBaseUrl);
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

  const elapsed = useMemo(() => {
    if (!project?.callStartedAt || project.callEndedAt) return null;
    const seconds = Math.max(0, Math.floor((now - Date.parse(project.callStartedAt)) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }, [now, project?.callEndedAt, project?.callStartedAt]);

  async function deployFixture() {
    setBusy("Deploying the Rose Street Barber fixture");
    setFixture(null);
    const response = await fetch("/api/deploy-fixture", { method: "POST" });
    const body = (await response.json()) as FixtureResult;
    setFixture(body);
    setBusy(null);
  }

  async function checkDns(hostname: string, cnameTarget: string) {
    setBusy("Checking DNS");
    const response = await fetch("/api/dns-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname, cnameTarget }),
    });
    const body = await response.json();
    setFixture((current) => ({ ...(current ?? { status: "deployed" }), ...body, hostname, cnameTarget }));
    setBusy(null);
  }

  async function cancelPublish() {
    if (!project) return;
    await fetch(`${voiceBaseUrl}/projects/${project.id}/cancel`, { method: "POST" });
  }

  const hostname = project?.hostname || fixture?.hostname;
  const target = project?.cnameTarget || fixture?.cnameTarget;
  const preview = project?.previewUrl || fixture?.previewUrl;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-brick">Porchline</p>
          <h1 className="mt-2 font-serif text-5xl leading-none">Operator desk</h1>
          <p className="mt-3 max-w-xl text-sm text-stone-700">
            {parentDomain
              ? `Shops publish under ${parentDomain}. Netlify hosts the page. Cloudflare writes the subdomain.`
              : "Add PORCHLINE_PARENT_DOMAIN to .env before the first deploy."}
          </p>
        </div>
        <div className="text-right text-sm">
          <a className="underline" href="/preview/fixture">
            Local fixture page
          </a>
          <span className="mx-2 text-stone-400">/</span>
          <a className="underline" href="/dev/call">
            Dev mic
          </a>
        </div>
      </header>

      {voiceError ? <p className="mt-6 rounded-md bg-white px-4 py-3 text-sm">{voiceError}</p> : null}
      {busy ? <p className="mt-6 text-sm text-brick">{busy}</p> : null}

      <section className="mt-8 grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-lg border border-line bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-2xl">Current call</h2>
            <span className="text-sm uppercase tracking-wide text-stone-500">
              {project?.status ?? "waiting"}
              {elapsed ? ` · ${elapsed}` : ""}
              {project?.callEndedAt && project.status === "draft" ? " · call ended" : ""}
            </span>
          </div>
          {project ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-stone-500">Caller</dt>
                <dd>{project.callerId}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Name</dt>
                <dd>{project.profile.businessName || "Not saved"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Kind of business</dt>
                <dd>{project.profile.category ? project.profile.category.replaceAll("_", " ") : "Not saved"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Summary</dt>
                <dd>{project.profile.summary || "Not saved"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Phone</dt>
                <dd>{project.profile.phone || "Not saved"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Hours</dt>
                <dd>{formatHours(project)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Services</dt>
                <dd>
                  {project.profile.services?.length
                    ? project.profile.services.map((service) => service.name).join(", ")
                    : "Not saved"}
                </dd>
              </div>
              <div>
                <dt className="text-stone-500">Subdomain</dt>
                <dd>
                  {project.profile.subdomainLabel
                    ? `${project.profile.subdomainLabel}.${parentDomain || "parent-domain"}`
                    : "Not saved"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-stone-600">Waiting for a call. Nothing is stored yet.</p>
          )}
          {project?.error ? <p className="mt-4 text-sm text-brick">{project.error}</p> : null}
          {project?.status === "deploying" ? (
            <button className="mt-4 rounded-full border border-ink px-4 py-2 text-sm" onClick={cancelPublish} type="button">
              Cancel publish
            </button>
          ) : null}
        </article>

        <article className="rounded-lg border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Transcript</h2>
          <ol className="mt-4 max-h-80 space-y-3 overflow-auto text-sm">
            {project?.transcript.length ? (
              project.transcript.map((line, index) => (
                <li key={`${line.at}-${index}`}>
                  <span className="text-stone-500">{line.role}</span>
                  <p>{line.text}</p>
                </li>
              ))
            ) : (
              <li className="text-stone-600">Lines show up here as the call is transcribed.</li>
            )}
          </ol>
        </article>
      </section>

      <section className="mt-6 rounded-lg border border-line bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-2xl">Site</h2>
          <button className="rounded-full bg-ink px-4 py-2 text-sm text-paper" onClick={deployFixture} type="button">
            Deploy fixture
          </button>
        </div>
        <p className="mt-2 text-sm text-stone-600">
          The fixture button publishes Rose Street Barber without a phone call. It needs the Netlify and Cloudflare values in .env.
        </p>
        {preview ? (
          <p className="mt-4 text-sm">
            Preview{" "}
            <a className="underline" href={preview}>
              {preview}
            </a>
          </p>
        ) : null}
        {hostname && target ? (
          <div className="mt-4 overflow-hidden rounded-md border border-line text-sm">
            <div className="grid grid-cols-3 bg-paper px-3 py-2 text-stone-500">
              <span>Hostname</span>
              <span>Type</span>
              <span>Target</span>
            </div>
            <div className="grid grid-cols-3 px-3 py-3">
              <span>{hostname}</span>
              <span>CNAME, DNS only</span>
              <span>{target}</span>
            </div>
          </div>
        ) : null}
        {fixture?.message ? <p className="mt-3 text-sm text-brick">{fixture.message}</p> : null}
        {fixture?.dnsStatus ? <p className="mt-3 text-sm">DNS: {fixture.dnsStatus}</p> : null}
        {hostname && target ? (
          <button
            className="mt-4 rounded-full border border-ink px-4 py-2 text-sm"
            onClick={() => checkDns(hostname, target)}
            type="button"
          >
            Check DNS
          </button>
        ) : null}
      </section>
    </main>
  );
}
