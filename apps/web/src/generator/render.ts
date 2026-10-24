import fs from "fs";
import path from "path";

import { DAY_NAMES, type Profile } from "@/lib/profile";

const CSS = fs.readFileSync(path.join(process.cwd(), "src/generator/template.css"), "utf8");

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dayLabel(day: (typeof DAY_NAMES)[number], profile: Profile): string {
  const hours = profile.hours[day];
  if (hours.closed || !hours.open || !hours.close) return "Closed";
  return `${hours.open}–${hours.close}`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function renderSite(profile: Profile): { html: string; css: string } {
  const services = profile.services
    .map((service) => {
      const price = service.priceLabel ? `<span>${escapeHtml(service.priceLabel)}</span>` : "";
      const blurb = service.blurb ? `<small>${escapeHtml(service.blurb)}</small>` : "";
      return `<li><span>${escapeHtml(service.name)}${blurb ? `<br>${blurb}` : ""}</span>${price}</li>`;
    })
    .join("");

  const hours = DAY_NAMES.map(
    (day) =>
      `<li><span>${day[0].toUpperCase()}${day.slice(1)}</span><span>${escapeHtml(dayLabel(day, profile))}</span></li>`,
  ).join("");

  const place = profile.address
    ? `<p class="place">${escapeHtml(profile.address)}</p>`
    : profile.serviceArea
      ? `<p class="place">${escapeHtml(profile.serviceArea)}</p>`
      : "";

  const email = profile.email
    ? `<p><a href="mailto:${escapeHtml(profile.email)}">${escapeHtml(profile.email)}</a></p>`
    : "";

  const highlight = profile.highlight ? `<p class="note">${escapeHtml(profile.highlight)}</p>` : "";
  const category = profile.category.replaceAll("_", " ");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(profile.businessName)}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body data-accent="${escapeHtml(profile.category)}">
  <main>
    <p class="eyebrow">${escapeHtml(category)}</p>
    <h1>${escapeHtml(profile.businessName)}</h1>
    <p class="summary">${escapeHtml(profile.summary)}</p>
    ${highlight}
    <a class="phone" href="${telHref(profile.phone)}">Call ${escapeHtml(profile.phone)}</a>
    <section>
      <h2>Services</h2>
      <ul>${services}</ul>
    </section>
    <section>
      <h2>Hours</h2>
      <ul class="hours">${hours}</ul>
    </section>
    <section>
      <h2>Visit</h2>
      ${place}
      ${email}
    </section>
    <footer>Built with Porchline</footer>
  </main>
</body>
</html>`;

  return { html, css: CSS };
}
