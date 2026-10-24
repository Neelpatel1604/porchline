import { z } from "zod";

const daySchema = z.object({
  closed: z.boolean(),
  open: z.string().nullable().optional(),
  close: z.string().nullable().optional(),
});

export const profileSchema = z.object({
  businessName: z.string().min(1),
  category: z.enum(["food", "personal_care", "home_services", "other"]),
  summary: z.string().min(1),
  phone: z.string().min(3),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  serviceArea: z.string().nullable().optional(),
  hours: z.object({
    monday: daySchema,
    tuesday: daySchema,
    wednesday: daySchema,
    thursday: daySchema,
    friday: daySchema,
    saturday: daySchema,
    sunday: daySchema,
  }),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        priceLabel: z.string().nullable().optional(),
        blurb: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(6),
  highlight: z.string().nullable().optional(),
  subdomainLabel: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
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
