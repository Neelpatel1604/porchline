"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Live desk" },
  { href: "/directory", label: "Directory" },
  { href: "/dev/call", label: "Dev mic" },
] as const;

export function StageNav({
  status,
  live = false,
}: {
  status?: string;
  live?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-white/12 pb-4">
      <div className="min-w-0">
        <p className="font-display text-3xl tracking-tight pl-text md:text-4xl">Porchline</p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Primary">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  active
                    ? "bg-amber-400 font-semibold text-[#1a1208]"
                    : "border border-white/20 text-white/85 hover:bg-white/5"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {status ? (
        <div
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            live ? "bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-300/40" : "bg-white/10 text-white/75"
          }`}
        >
          {live ? <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" /> : null}
          {status}
        </div>
      ) : null}
    </header>
  );
}
