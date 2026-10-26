import { z } from "zod";

const daySchema = z.object({
  closed: z.boolean(),
  open: z.string().nullable().optional(),
  close: z.string().nullable().optional(),
});

export const profileSchema = z.object({
  businessName: z.string().default(""),
  category: z.enum(["food", "personal_care", "home_services", "other", ""]).default(""),
  summary: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  serviceArea: z.string().nullable().optional(),
  hours: z.record(daySchema).default({}),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        priceLabel: z.string().nullable().optional(),
        blurb: z.string().nullable().optional(),
      }),
    )
    .max(6)
    .default([]),
  highlight: z.string().nullable().optional(),
  vibe: z.string().nullable().optional(),
  look: z.string().nullable().optional(),
  heroLine: z.string().nullable().optional(),
  audience: z.string().nullable().optional(),
  siteSlug: z
    .string()
    .regex(/^(|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$/)
    .default(""),
  confirmed: z.literal(true),
  sourceCallId: z.string().min(1),
});

export type Profile = z.infer<typeof profileSchema>;

export const DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export function ensurePublishDefaults(profile: Profile): Profile {
  const next = { ...profile };
  // Do not invent a brand name or marketing summary — voice must supply a real businessName.
  if (!next.category) next.category = "other";
  if (!next.summary.trim() && next.businessName.trim()) {
    next.summary = `${next.businessName.trim()}.`;
  }
  if (!next.siteSlug.trim()) {
    const label = next.businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    next.siteSlug = label || "shop";
  }
  return next;
}
