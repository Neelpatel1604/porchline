import { type Profile } from "@/lib/profile";
import { renderSite } from "@/generator/render";

export type SiteBundle = {
  html: string;
  css: string;
  js?: string;
  source: "gemini" | "template";
  note?: string;
};

const SYSTEM = `You are an elite freelance web designer and front-end engineer.
Build a COMPLETE one-page marketing website for a local business — not a thin brochure card.

Return ONLY a JSON object with keys:
- "html": complete HTML document starting with <!doctype html>
- "css": full stylesheet (substantial; this is most of the craft)
- "js": optional small vanilla JS string (or empty string)

No markdown fences. No commentary outside the JSON.

Required page anatomy (always include):
1. Sticky top navigation with the business name, in-page links (About, Services, Hours, Contact — only link sections that exist), and a primary CTA (Call / Visit / Contact).
2. Full-bleed hero: brand name as the hero signal, one headline, one supporting sentence, CTA group, and a dominant visual plane (gradient, pattern, large type, or SVG composition). No floating badges or promo chips on the hero.
3. About / story section.
4. Services or menu section when services exist (cards or rows with optional prices).
5. Hours section when hours exist.
6. Visit / contact section (address or service area, phone, email, map placeholder only if address exists — do not invent an address).
7. Full site footer: quick links, contact summary, and the exact text: Built with Porchline.

Creative freedom:
- Invent a strong art direction for THIS shop. Avoid generic purple SaaS, cream-serif-terracotta cliche, flat one-column pamphlet, or sparse centered-card layouts.
- Typography must match Porchline brand fonts: load Google Fonts "Syne" (display / brand / headings) and "Source Sans 3" (body). Use <link rel="preconnect"> + the Google Fonts CSS link in <head>.
- CSS should set headings/brand to Syne and body copy to Source Sans 3. Do not substitute other typefaces.
- Define CSS variables for colors, type, and spacing. Atmosphere through gradients, patterns, or large type.
- Desktop must feel like a real website (wide sections, nav, footer), not a phone note stretched to fill the screen.
- Mobile-first, with a working mobile nav (hamburger or compact links via CSS/JS).
- At least 2 intentional motions (entrance, scroll, or hover). Light vanilla JS is fine.
- Inline SVG / decorative shapes encouraged. Do not hotlink stock photos.
- Link CSS as href="./styles.css". If js is non-empty, include <script src="./script.js" defer></script> before </body>.

Hard factual limits:
- Use ONLY non-empty facts from the profile JSON. Render the real businessName, summary, phone, email, address/serviceArea, hours, services, and style fields when present.
- Never invent hours, prices, services, reviews, ratings, years in business, awards, credentials, emails, or street addresses.
- Do not replace a missing name with "Local business" in the visible brand if a better profile field exists; if businessName is empty, use a short neutral brand mark from category only.
- You may invent visual design, layout, section titles, and short UI chrome that does not claim new business facts.
- Sparse profiles are valid: still ship the full nav + hero + footer shell; omit empty content sections.

Quality bar: a paid custom one-pager a designer would ship — with navigation, footer, and proper webfonts — never a template dump.`;

function extractJson(text: string): { html: string; css: string; js?: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Site builder returned no JSON object");
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    html?: unknown;
    css?: unknown;
    js?: unknown;
  };
  if (typeof parsed.html !== "string" || typeof parsed.css !== "string") {
    throw new Error("Site builder JSON missing html or css");
  }
  if (!parsed.html.toLowerCase().includes("<!doctype html")) {
    throw new Error("Site builder HTML is incomplete");
  }
  if (!parsed.html.includes("./styles.css")) {
    throw new Error("Site builder HTML must link ./styles.css");
  }
  if (!/<nav[\s>]/i.test(parsed.html)) {
    throw new Error("Site builder HTML missing <nav>");
  }
  if (!/<footer[\s>]/i.test(parsed.html)) {
    throw new Error("Site builder HTML missing <footer>");
  }
  if (!parsed.html.includes("Built with Porchline")) {
    throw new Error("Site builder HTML missing Porchline footer");
  }
  const js = typeof parsed.js === "string" ? parsed.js : "";
  if (js.trim() && !parsed.html.includes("./script.js")) {
    throw new Error("Site builder HTML must load ./script.js when js is present");
  }
  return { html: parsed.html, css: parsed.css, js: js.trim() || undefined };
}

function geminiKey(): string {
  const direct = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (direct) return direct;
  // Tolerate accidental trailing spaces on the env key name in .env
  for (const [name, value] of Object.entries(process.env)) {
    if (name.trim() === "GEMINI_API_KEY" && value?.trim()) return value.trim();
  }
  return "";
}

async function callGemini(profile: Profile): Promise<SiteBundle> {
  const apiKey = geminiKey();
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  const model = process.env.SITE_BUILDER_MODEL?.trim() || "gemini-4-argon";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Build a full one-page website with sticky nav, full-bleed hero, content sections, and a real footer. " +
                "Use Google Fonts Syne for headings/brand and Source Sans 3 for body text only. " +
                "Put every non-empty profile fact on the page. Do not invent business facts.\n\nProfile JSON:\n" +
                JSON.stringify(profile, null, 2),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
        // medium keeps enough craft without burning the non-streaming output budget on thinking
        thinkingConfig: { thinkingLevel: "medium" },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text.trim()) {
    throw new Error("Gemini returned no text");
  }
  const bundle = extractJson(text);
  return { ...bundle, source: "gemini" };
}

export async function buildSite(profile: Profile): Promise<SiteBundle> {
  try {
    return await callGemini(profile);
  } catch (error) {
    console.error("AI site builder failed, using template:", error);
    const reason = error instanceof Error ? error.message : "unknown error";
    const fallback = renderSite(profile);
    return {
      ...fallback,
      source: "template",
      note: `Gemini builder failed (${reason}). Deployed the fuller template with nav and footer instead.`,
    };
  }
}
