"use client";

import { useEffect, useMemo, useState } from "react";

type Profile = {
  businessName?: string;
  category?: string;
  summary?: string;
  phone?: string;
  email?: string | null;
  address?: string | null;
  serviceArea?: string | null;
  hours?: Record<string, { closed: boolean; open?: string | null; close?: string | null }>;
  services?: { name: string; priceLabel?: string | null; blurb?: string | null }[];
  highlight?: string | null;
  vibe?: string | null;
  look?: string | null;
  heroLine?: string | null;
  audience?: string | null;
  siteSlug?: string;
};

type ContactSummary = {
  callerId: string;
  businessName?: string | null;
  phone: string;
  email?: string | null;
  category?: string | null;
  status?: string | null;
  previewUrl?: string | null;
  hostname?: string | null;
  latestProjectId?: string;
  callCount: number;
  cadence: string;
  avgDaysBetweenCalls?: number | null;
  firstCallAt?: string | null;
  lastCallAt?: string | null;
  updatedAt?: string | null;
  profile?: Profile;
};

type ContactDetail = ContactSummary & {
  projects: {
    id: string;
    status: string;
    callStartedAt?: string | null;
    updatedAt?: string | null;
    previewUrl?: string | null;
    transcript?: { role: string; text: string; at: string }[];
    profile: Profile;
  }[];
};

type EditForm = {
  businessName: string;
  category: string;
  summary: string;
  phone: string;
  email: string;
  address: string;
  serviceArea: string;
  highlight: string;
  vibe: string;
  look: string;
  heroLine: string;
  audience: string;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatHours(profile?: Profile): string {
  const hours = profile?.hours;
  if (!hours) return "—";
  const parts = DAYS.filter((day) => hours[day]).map((day) => {
    const value = hours[day];
    const label = value?.closed || !value?.open ? "Closed" : `${value.open}–${value.close}`;
    return `${day.slice(0, 3)} ${label}`;
  });
  return parts.length ? parts.join(" · ") : "—";
}

function emptyForm(profile?: Profile | null): EditForm {
  return {
    businessName: profile?.businessName || "",
    category: profile?.category || "",
    summary: profile?.summary || "",
    phone: profile?.phone || "",
    email: profile?.email || "",
    address: profile?.address || "",
    serviceArea: profile?.serviceArea || "",
    highlight: profile?.highlight || "",
    vibe: profile?.vibe || "",
    look: profile?.look || "",
    heroLine: profile?.heroLine || "",
    audience: profile?.audience || "",
  };
}

export function DirectoryView({ voiceBaseUrl }: { voiceBaseUrl: string }) {
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(emptyForm());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadDetail(callerId: string) {
    setMessage(null);
    try {
      const response = await fetch(`${voiceBaseUrl}/directory/caller/${encodeURIComponent(callerId)}`);
      if (!response.ok) throw new Error("missing");
      const body = (await response.json()) as { contact: ContactDetail };
      setDetail(body.contact);
      setForm(emptyForm(body.contact.profile));
      setEditing(false);
    } catch {
      setDetail(null);
      setMessage("Could not load this contact.");
    }
  }

  async function loadContacts(preferCaller?: string | null) {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${voiceBaseUrl}/directory`);
      if (!response.ok) throw new Error("Failed to load directory");
      const body = (await response.json()) as { contacts: ContactSummary[] };
      const list = body.contacts || [];
      setContacts(list);
      const nextId = preferCaller || selectedId || list[0]?.callerId || null;
      setSelectedId(nextId);
      if (nextId) await loadDetail(nextId);
      else setDetail(null);
    } catch {
      setContacts([]);
      setDetail(null);
      setMessage("Could not load directory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on mount / voice host change
  }, [voiceBaseUrl]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((item) => {
      const hay = [item.businessName, item.phone, item.callerId, item.email, item.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [contacts, query]);

  async function saveEdits() {
    if (!detail?.latestProjectId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${voiceBaseUrl}/projects/${detail.latestProjectId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          category: form.category.trim(),
          summary: form.summary.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          serviceArea: form.serviceArea.trim() || null,
          highlight: form.highlight.trim() || null,
          vibe: form.vibe.trim() || null,
          look: form.look.trim() || null,
          heroLine: form.heroLine.trim() || null,
          audience: form.audience.trim() || null,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      setMessage("Saved to database.");
      setEditing(false);
      await loadContacts(detail.callerId);
    } catch {
      setMessage("Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCall(projectId: string) {
    if (!window.confirm("Delete this call record?")) return;
    setBusy(true);
    try {
      const response = await fetch(`${voiceBaseUrl}/projects/${projectId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete failed");
      await loadContacts(detail?.callerId);
      setMessage("Call deleted.");
    } catch {
      setMessage("Could not delete that call.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteContact() {
    if (!detail) return;
    if (!window.confirm(`Delete all data for ${detail.businessName || detail.phone || detail.callerId}?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`${voiceBaseUrl}/directory/caller/${encodeURIComponent(detail.callerId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("delete failed");
      setSelectedId(null);
      setDetail(null);
      await loadContacts(null);
      setMessage("Contact removed.");
    } catch {
      setMessage("Could not delete contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pl-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-white/12 px-5 py-4">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-amber-200/80">Operator directory</p>
            <h2 className="font-display mt-1 text-2xl tracking-tight pl-text md:text-3xl">Customers &amp; calls</h2>
            <p className="mt-1 max-w-xl text-sm pl-muted">
              Numbers, saved profiles, and how often each caller reaches Porchline.
            </p>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[0.95fr_1.35fr]">
          <aside className="flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="border-b border-white/10 p-4">
              <input
                className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-amber-300/40"
                placeholder="Search name, phone, email…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <p className="mt-2 text-xs pl-subtle">
                {filtered.length} contact{filtered.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
              {loading && !contacts.length ? (
                <p className="p-5 text-sm pl-muted">Loading directory…</p>
              ) : filtered.length ? (
                <ul className="divide-y divide-white/8">
                  {filtered.map((item) => {
                    const active = selectedId === item.callerId;
                    return (
                      <li key={item.callerId}>
                        <button
                          className={`w-full px-5 py-4 text-left transition hover:bg-white/[0.04] ${
                            active ? "bg-white/[0.07]" : ""
                          }`}
                          onClick={() => {
                            setSelectedId(item.callerId);
                            void loadDetail(item.callerId);
                          }}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium pl-text">
                                {item.businessName || "Unnamed business"}
                              </p>
                              <p className="mt-1 truncate text-sm pl-muted">{item.phone}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-white/8 px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.12em] text-amber-100/80">
                              {item.cadence}
                            </span>
                          </div>
                          <p className="mt-2 text-xs pl-subtle">
                            {item.callCount} call{item.callCount === 1 ? "" : "s"} · last {formatWhen(item.lastCallAt)}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="p-5 text-sm pl-muted">No contacts yet. Place a call to start the directory.</p>
              )}
            </div>
          </aside>

          <section className="panel-scroll min-h-0 overflow-y-auto p-5 md:p-7">
            {message ? <p className="mb-4 text-sm text-amber-100/90">{message}</p> : null}
            {detail ? (
              <div className="space-y-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-3xl tracking-tight pl-text">
                      {detail.businessName || "Unnamed business"}
                    </h3>
                    <p className="mt-2 text-lg pl-text">{detail.phone}</p>
                    <p className="mt-1 text-sm pl-subtle">Caller ID · {detail.callerId}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.previewUrl ? (
                      <a
                        className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-[#1a1208] hover:bg-amber-300"
                        href={detail.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open site
                      </a>
                    ) : null}
                    <button
                      className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/85 hover:bg-white/5 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        setEditing((value) => !value);
                        setForm(emptyForm(detail.profile));
                      }}
                      type="button"
                    >
                      {editing ? "Cancel edit" : "Edit profile"}
                    </button>
                    <button
                      className="rounded-full border border-rose-300/30 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/10 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void deleteContact()}
                      type="button"
                    >
                      Delete contact
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="pl-panel-inner rounded-2xl px-4 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.14em] pl-subtle">Calls</p>
                    <p className="mt-1 font-display text-2xl pl-text">{detail.callCount}</p>
                    <p className="text-xs pl-subtle">{detail.cadence}</p>
                  </div>
                  <div className="pl-panel-inner rounded-2xl px-4 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.14em] pl-subtle">Last call</p>
                    <p className="mt-1 text-sm pl-text">{formatWhen(detail.lastCallAt)}</p>
                    <p className="text-xs pl-subtle">First {formatWhen(detail.firstCallAt)}</p>
                  </div>
                  <div className="pl-panel-inner rounded-2xl px-4 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.14em] pl-subtle">Cadence</p>
                    <p className="mt-1 text-sm pl-text">
                      {detail.avgDaysBetweenCalls != null
                        ? `About every ${detail.avgDaysBetweenCalls} day${detail.avgDaysBetweenCalls === 1 ? "" : "s"}`
                        : "Only one call so far"}
                    </p>
                    <p className="text-xs pl-subtle">Status · {detail.status || "—"}</p>
                  </div>
                </div>

                {editing ? (
                  <div className="pl-panel-inner space-y-4 rounded-3xl p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      {(
                        [
                          ["businessName", "Business name"],
                          ["category", "Category"],
                          ["phone", "Phone"],
                          ["email", "Email"],
                          ["address", "Address"],
                          ["serviceArea", "Service area"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="block">
                          <span className="text-[0.68rem] uppercase tracking-[0.14em] text-amber-200">{label}</span>
                          <input
                            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300/40"
                            value={form[key]}
                            onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="block">
                      <span className="text-[0.68rem] uppercase tracking-[0.14em] text-amber-200">Summary</span>
                      <textarea
                        className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300/40"
                        rows={3}
                        value={form.summary}
                        onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))}
                      />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      {(
                        [
                          ["highlight", "Highlight"],
                          ["heroLine", "Hero line"],
                          ["vibe", "Vibe"],
                          ["look", "Look"],
                          ["audience", "Audience"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="block">
                          <span className="text-[0.68rem] uppercase tracking-[0.14em] text-amber-200">{label}</span>
                          <input
                            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300/40"
                            value={form[key]}
                            onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-semibold text-[#1a1208] hover:bg-amber-300 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void saveEdits()}
                      type="button"
                    >
                      Save to database
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-6 md:grid-cols-2">
                    <dl>
                      <DetailRow label="Email" value={detail.email || "—"} />
                      <DetailRow label="Category" value={detail.category || "—"} />
                      <DetailRow label="Address" value={detail.profile?.address || "—"} />
                      <DetailRow label="Service area" value={detail.profile?.serviceArea || "—"} />
                      <DetailRow label="Summary" value={detail.profile?.summary || "—"} />
                    </dl>
                    <dl>
                      <DetailRow label="Hours" value={formatHours(detail.profile)} />
                      <DetailRow
                        label="Services"
                        value={
                          detail.profile?.services?.length
                            ? detail.profile.services
                                .map((service) =>
                                  service.priceLabel ? `${service.name} (${service.priceLabel})` : service.name,
                                )
                                .join(", ")
                            : "—"
                        }
                      />
                      <DetailRow
                        label="Style"
                        value={
                          [detail.profile?.vibe, detail.profile?.look, detail.profile?.heroLine, detail.profile?.audience]
                            .filter(Boolean)
                            .join(" · ") || "—"
                        }
                      />
                      <DetailRow label="Site host" value={detail.hostname || "—"} />
                    </dl>
                  </div>
                )}

                <div>
                  <h4 className="font-display text-xl pl-text">Call history</h4>
                  <ul className="pl-panel-inner mt-3 divide-y divide-white/10 rounded-2xl">
                    {(detail.projects || []).map((project) => (
                      <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <p className="text-sm pl-text">{formatWhen(project.callStartedAt || project.updatedAt)}</p>
                          <p className="text-xs pl-subtle">
                            {project.status} · {project.transcript?.length || 0} transcript lines
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {project.previewUrl ? (
                            <a
                              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5"
                              href={project.previewUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Site
                            </a>
                          ) : null}
                          <button
                            className="rounded-full border border-rose-300/25 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-500/10 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void deleteCall(project.id)}
                            type="button"
                          >
                            Delete call
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-sm pl-muted">Select a contact to see their number, profile, and call cadence.</p>
            )}
          </section>
        </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-0">
      <dt className="text-[0.68rem] uppercase tracking-[0.14em] text-amber-200">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed pl-text">{value}</dd>
    </div>
  );
}
