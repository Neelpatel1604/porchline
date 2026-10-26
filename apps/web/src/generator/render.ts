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
  const hours = profile.hours?.[day];
  if (!hours || hours.closed || !hours.open || !hours.close) return "Closed";
  return `${hours.open}–${hours.close}`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function renderSite(profile: Profile): { html: string; css: string } {
  const name = escapeHtml(profile.businessName.trim() || "Business");
  const categoryKey = profile.category || "other";
  const categoryLabel = escapeHtml(categoryKey.replaceAll("_", " "));
  const summary = profile.summary ? escapeHtml(profile.summary) : "";
  const highlight = profile.highlight ? escapeHtml(profile.highlight) : "";
  const heroLine = profile.heroLine ? escapeHtml(profile.heroLine) : summary;
  const phone = profile.phone?.trim();
  const email = profile.email?.trim();
  const place = profile.address
    ? escapeHtml(profile.address)
    : profile.serviceArea
      ? escapeHtml(profile.serviceArea)
      : "";

  const services = (profile.services || [])
    .map((service) => {
      const price = service.priceLabel ? `<span class="price">${escapeHtml(service.priceLabel)}</span>` : "";
      const blurb = service.blurb ? `<p>${escapeHtml(service.blurb)}</p>` : "";
      return `<article class="service"><h3>${escapeHtml(service.name)}</h3>${blurb}${price}</article>`;
    })
    .join("");

  const savedDays = DAY_NAMES.filter((day) => profile.hours?.[day]);
  const hours = savedDays
    .map(
      (day) =>
        `<li><span>${day[0].toUpperCase()}${day.slice(1)}</span><span>${escapeHtml(dayLabel(day, profile))}</span></li>`,
    )
    .join("");

  const navLinks = [
    summary || highlight ? `<a href="#about">About</a>` : "",
    services ? `<a href="#services">Services</a>` : "",
    hours ? `<a href="#hours">Hours</a>` : "",
    `<a href="#contact">Contact</a>`,
  ]
    .filter(Boolean)
    .join("");

  const phoneCta = phone
    ? `<a class="btn" href="${telHref(phone)}">Call ${escapeHtml(phone)}</a>`
    : `<a class="btn" href="#contact">Get in touch</a>`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&family=Syne:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css">
</head>
<body data-accent="${escapeHtml(categoryKey)}">
  <header class="top">
    <nav class="nav" aria-label="Primary">
      <a class="brand" href="#top">${name}</a>
      <div class="nav-links">${navLinks}</div>
      ${phone ? `<a class="nav-cta" href="${telHref(phone)}">Call</a>` : `<a class="nav-cta" href="#contact">Contact</a>`}
    </nav>
  </header>

  <main id="top">
    <section class="hero">
      <p class="eyebrow">${categoryLabel}</p>
      <h1>${name}</h1>
      ${heroLine ? `<p class="lede">${heroLine}</p>` : ""}
      <div class="hero-actions">${phoneCta}<a class="btn ghost" href="#contact">Visit</a></div>
    </section>

    ${
      summary || highlight
        ? `<section id="about" class="section">
      <h2>About</h2>
      ${summary ? `<p class="summary">${summary}</p>` : ""}
      ${highlight ? `<p class="note">${highlight}</p>` : ""}
    </section>`
        : ""
    }

    ${
      services
        ? `<section id="services" class="section">
      <h2>Services</h2>
      <div class="service-grid">${services}</div>
    </section>`
        : ""
    }

    ${
      hours
        ? `<section id="hours" class="section">
      <h2>Hours</h2>
      <ul class="hours">${hours}</ul>
    </section>`
        : ""
    }

    <section id="contact" class="section contact">
      <h2>Visit</h2>
      ${place ? `<p class="place">${place}</p>` : ""}
      ${phone ? `<p><a href="${telHref(phone)}">${escapeHtml(phone)}</a></p>` : ""}
      ${email ? `<p><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>` : ""}
    </section>
  </main>

  <footer class="site-footer">
    <div>
      <strong>${name}</strong>
      <p>${categoryLabel}</p>
    </div>
    <div class="footer-links">
      ${summary || highlight ? `<a href="#about">About</a>` : ""}
      ${services ? `<a href="#services">Services</a>` : ""}
      ${hours ? `<a href="#hours">Hours</a>` : ""}
      <a href="#contact">Contact</a>
    </div>
    <p class="credit">Built with Porchline</p>
  </footer>
</body>
</html>`;

  return { html, css: CSS };
}
