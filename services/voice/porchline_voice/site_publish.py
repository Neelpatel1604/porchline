"""Build a site with Gemini (template fallback) and deploy to Netlify.

Runs on the voice host (EC2) so publish is not killed by Netlify function timeouts.
"""

from __future__ import annotations

import io
import json
import os
import re
import time
import zipfile
from html import escape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from porchline_voice.profile import DAYS, missing_for_publish

SYSTEM = """You are an elite freelance web designer and front-end engineer.
Build a COMPLETE one-page marketing website for a local business.

Return ONLY a JSON object with keys:
- "html": complete HTML document starting with <!doctype html>
- "css": full stylesheet
- "js": optional small vanilla JS string (or empty string)

No markdown fences. No commentary outside the JSON.

Required: sticky nav with business name, full-bleed hero, about/services/hours/contact as facts allow,
footer with exact text: Built with Porchline.
Use Google Fonts Syne (headings) and Source Sans 3 (body). Link CSS as ./styles.css.
If js is non-empty, include <script src="./script.js" defer></script>.
Use ONLY non-empty facts from the profile. Never invent business facts."""

TEMPLATE_CSS = """
:root {
  --bg: #0f1410; --ink: #f4f1ea; --muted: #c5c0b4; --line: rgba(244,241,234,0.14);
  --accent: #d4a017; --font-display: "Syne", sans-serif; --font-body: "Source Sans 3", sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: radial-gradient(circle at top left, #243028, var(--bg) 45%);
  color: var(--ink); font-family: var(--font-body); line-height: 1.55;
}
a { color: inherit; }
.top { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(10px); background: rgba(15,20,16,0.82); border-bottom: 1px solid var(--line); }
.nav { max-width: 1100px; margin: 0 auto; padding: 0.9rem 1.25rem; display: flex; gap: 1rem; align-items: center; justify-content: space-between; }
.brand { font-family: var(--font-display); font-weight: 700; text-decoration: none; font-size: 1.15rem; }
.nav-links { display: flex; gap: 1rem; flex-wrap: wrap; }
.nav-links a, .footer-links a { text-decoration: none; color: var(--muted); }
.nav-cta, .btn {
  display: inline-block; text-decoration: none; background: var(--accent); color: #1a1405;
  padding: 0.65rem 1rem; font-weight: 700; border-radius: 999px;
}
.btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
.hero {
  min-height: 78vh; display: grid; align-content: end; gap: 0.75rem;
  padding: 5rem 1.25rem 3rem; max-width: 1100px; margin: 0 auto;
  background:
    linear-gradient(180deg, transparent, rgba(15,20,16,0.55) 70%),
    repeating-linear-gradient(-18deg, transparent 0 18px, rgba(212,160,23,0.05) 18px 19px);
}
.eyebrow { text-transform: uppercase; letter-spacing: 0.16em; color: var(--accent); font-size: 0.75rem; margin: 0; }
.hero h1 { font-family: var(--font-display); font-size: clamp(2.6rem, 8vw, 5.2rem); line-height: 0.95; margin: 0; }
.lede { max-width: 36rem; font-size: 1.15rem; color: var(--muted); }
.hero-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem; }
.section { max-width: 1100px; margin: 0 auto; padding: 3rem 1.25rem; border-top: 1px solid var(--line); }
.section h2 { font-family: var(--font-display); font-size: 1.8rem; margin: 0 0 1rem; }
.service-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.service { border: 1px solid var(--line); padding: 1rem; border-radius: 1rem; }
.price { display: block; margin-top: 0.75rem; color: var(--accent); font-weight: 700; }
.hours { list-style: none; padding: 0; margin: 0; max-width: 28rem; }
.hours li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.45rem 0; border-bottom: 1px solid var(--line); }
.site-footer {
  max-width: 1100px; margin: 0 auto; padding: 2.5rem 1.25rem 3rem;
  display: grid; gap: 1rem; border-top: 1px solid var(--line);
}
.credit { color: var(--muted); margin: 0; }
@media (max-width: 720px) {
  .nav-links { display: none; }
}
""".strip()


def _http_json(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, body: bytes | None = None, timeout: int = 120) -> Any:
    req = Request(url, data=body, method=method, headers=headers or {})
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(str(exc.reason or exc)) from exc


def _slug(profile: dict[str, Any]) -> str:
    raw = str(profile.get("siteSlug") or profile.get("businessName") or "shop").lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", raw).strip("-") or "shop"
    return cleaned[:40]


def _template_site(profile: dict[str, Any]) -> dict[str, str]:
    name = escape(str(profile.get("businessName") or "Business").strip() or "Business")
    category = escape(str(profile.get("category") or "other").replace("_", " "))
    summary = escape(str(profile.get("summary") or "").strip())
    phone = str(profile.get("phone") or "").strip()
    email = str(profile.get("email") or "").strip()
    place = escape(str(profile.get("address") or profile.get("serviceArea") or "").strip())
    hero = escape(str(profile.get("heroLine") or profile.get("summary") or "").strip())
    services = profile.get("services") or []
    hours = profile.get("hours") or {}

    service_html = "".join(
        (
            "<article class='service'><h3>"
            + escape(str(item.get("name") or ""))
            + "</h3>"
            + (f"<p>{escape(str(item.get('blurb')))}</p>" if item.get("blurb") else "")
            + (f"<span class='price'>{escape(str(item.get('priceLabel')))}</span>" if item.get("priceLabel") else "")
            + "</article>"
        )
        for item in services
        if isinstance(item, dict) and item.get("name")
    )
    hours_html = "".join(
        (
            f"<li><span>{day[:1].upper()}{day[1:]}</span><span>"
            + (
                "Closed"
                if not isinstance(value, dict) or value.get("closed") or not value.get("open")
                else f"{escape(str(value.get('open')))}–{escape(str(value.get('close')))}"
            )
            + "</span></li>"
        )
        for day in DAYS
        for value in [hours.get(day)]
        if value
    )
    tel = re.sub(r"[^\d+]", "", phone)
    phone_cta = (
        f"<a class='btn' href='tel:{tel}'>Call {escape(phone)}</a>"
        if phone
        else "<a class='btn' href='#contact'>Get in touch</a>"
    )
    nav_cta = (
        f'<a class="nav-cta" href="tel:{tel}">Call</a>'
        if phone
        else '<a class="nav-cta" href="#contact">Contact</a>'
    )
    phone_line = (
        f'<p><a href="tel:{tel}">{escape(phone)}</a></p>' if phone else ""
    )
    email_line = (
        f'<p><a href="mailto:{escape(email)}">{escape(email)}</a></p>' if email else ""
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&family=Syne:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="top"><nav class="nav" aria-label="Primary">
    <a class="brand" href="#top">{name}</a>
    <div class="nav-links">
      {('<a href="#about">About</a>' if summary else '')}
      {('<a href="#services">Services</a>' if service_html else '')}
      {('<a href="#hours">Hours</a>' if hours_html else '')}
      <a href="#contact">Contact</a>
    </div>
    {nav_cta}
  </nav></header>
  <main id="top">
    <section class="hero">
      <p class="eyebrow">{category}</p>
      <h1>{name}</h1>
      {f'<p class="lede">{hero}</p>' if hero else ''}
      <div class="hero-actions">{phone_cta}<a class="btn ghost" href="#contact">Visit</a></div>
    </section>
    {f'<section id="about" class="section"><h2>About</h2><p class="summary">{summary}</p></section>' if summary else ''}
    {f'<section id="services" class="section"><h2>Services</h2><div class="service-grid">{service_html}</div></section>' if service_html else ''}
    {f'<section id="hours" class="section"><h2>Hours</h2><ul class="hours">{hours_html}</ul></section>' if hours_html else ''}
    <section id="contact" class="section contact">
      <h2>Visit</h2>
      {f'<p class="place">{place}</p>' if place else ''}
      {phone_line}
      {email_line}
    </section>
  </main>
  <footer class="site-footer">
    <div><strong>{name}</strong><p>{category}</p></div>
    <div class="footer-links">
      {('<a href="#about">About</a>' if summary else '')}
      {('<a href="#services">Services</a>' if service_html else '')}
      {('<a href="#hours">Hours</a>' if hours_html else '')}
      <a href="#contact">Contact</a>
    </div>
    <p class="credit">Built with Porchline</p>
  </footer>
</body>
</html>"""
    return {"html": html, "css": TEMPLATE_CSS, "js": ""}


def _extract_json(text: str) -> dict[str, str]:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    raw = (fenced.group(1) if fenced else text).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Site builder returned no JSON object")
    parsed = json.loads(raw[start : end + 1])
    html = parsed.get("html")
    css = parsed.get("css")
    if not isinstance(html, str) or not isinstance(css, str):
        raise RuntimeError("Site builder JSON missing html or css")
    if "<!doctype html" not in html.lower():
        raise RuntimeError("Site builder HTML is incomplete")
    if "./styles.css" not in html:
        raise RuntimeError("Site builder HTML must link ./styles.css")
    if not re.search(r"<nav[\s>]", html, re.I):
        raise RuntimeError("Site builder HTML missing <nav>")
    if not re.search(r"<footer[\s>]", html, re.I):
        raise RuntimeError("Site builder HTML missing <footer>")
    if "Built with Porchline" not in html:
        raise RuntimeError("Site builder HTML missing Porchline footer")
    js = parsed.get("js") if isinstance(parsed.get("js"), str) else ""
    if js.strip() and "./script.js" not in html:
        raise RuntimeError("Site builder HTML must load ./script.js when js is present")
    return {"html": html, "css": css, "js": js.strip()}


def _gemini_site(profile: dict[str, Any]) -> dict[str, Any]:
    api_key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY")
    model = (os.environ.get("SITE_BUILDER_MODEL") or "gemini-4-argon").strip()
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={api_key}"
    )
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Build a full one-page website with sticky nav, full-bleed hero, "
                            "content sections, and a real footer. Use Google Fonts Syne and Source Sans 3. "
                            "Put every non-empty profile fact on the page. Do not invent business facts.\n\n"
                            f"Profile JSON:\n{json.dumps(profile, ensure_ascii=True, indent=2)}"
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 1.0,
            "maxOutputTokens": 65536,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingLevel": "medium"},
        },
    }
    body = _http_json(
        url,
        method="POST",
        headers={"content-type": "application/json"},
        body=json.dumps(payload).encode("utf-8"),
        timeout=150,
    )
    parts = (((body.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
    text = "".join(str(part.get("text") or "") for part in parts)
    if not text.strip():
        raise RuntimeError("Gemini returned no text")
    bundle = _extract_json(text)
    return {**bundle, "source": "gemini"}


def _build_site(profile: dict[str, Any]) -> dict[str, Any]:
    try:
        return _gemini_site(profile)
    except Exception as exc:  # noqa: BLE001 - fall back to template for the phone path
        fallback = _template_site(profile)
        return {
            **fallback,
            "source": "template",
            "note": f"Gemini builder failed ({exc}). Deployed the template instead.",
        }


def _ensure_site(token: str, site_id: str | None, site_name: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if site_id:
        try:
            existing = _http_json(
                f"https://api.netlify.com/api/v1/sites/{site_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30,
            )
            if existing.get("id"):
                return existing
        except RuntimeError:
            pass
    attempts = [site_name[:50], f"{site_name[:42]}-{int(time.time()) % 1000000}"]
    last_error = "unknown"
    for name in attempts:
        try:
            created = _http_json(
                "https://api.netlify.com/api/v1/sites",
                method="POST",
                headers=headers,
                body=json.dumps({"name": name}).encode("utf-8"),
                timeout=30,
            )
            return created
        except RuntimeError as exc:
            last_error = str(exc)
            if "must be unique" not in last_error:
                raise
    raise RuntimeError(f"Netlify site create failed: {last_error}")


def _netlify_host(site: dict[str, Any]) -> str:
    if site.get("default_domain"):
        return str(site["default_domain"])
    for key in ("ssl_url", "url"):
        value = site.get(key)
        if value:
            return str(value).replace("https://", "").replace("http://", "").split("/")[0]
    return f"{site.get('name', 'site')}.netlify.app"


def _deploy_zip(token: str, site_id: str, files: dict[str, str]) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("index.html", files["html"])
        archive.writestr("styles.css", files["css"])
        if files.get("js"):
            archive.writestr("script.js", files["js"])
    payload = buffer.getvalue()
    req = Request(
        f"https://api.netlify.com/api/v1/sites/{site_id}/deploys",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/zip",
        },
    )
    try:
        with urlopen(req, timeout=60) as resp:
            resp.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"Netlify deploy failed: HTTP {exc.code}: {detail}") from exc


def publish_profile_local(
    *,
    project_id: str,
    profile: dict[str, Any],
    netlify_site_id: str | None = None,
) -> dict[str, Any]:
    missing = missing_for_publish(profile)
    if missing:
        return {
            "status": "error",
            "projectId": project_id,
            "message": "businessName is required before publish",
        }
    token = (os.environ.get("NETLIFY_AUTH_TOKEN") or "").strip()
    if not token:
        return {"status": "error", "projectId": project_id, "message": "Missing NETLIFY_AUTH_TOKEN"}

    try:
        rendered = _build_site(profile)
        site_name = f"porchline-{_slug(profile)}"[:50]
        site = _ensure_site(token, netlify_site_id, site_name)
        _deploy_zip(token, str(site["id"]), rendered)
        hostname = _netlify_host(site)
        preview_url = site.get("ssl_url") or f"https://{hostname}"
        return {
            "status": "deployed",
            "projectId": project_id,
            "previewUrl": preview_url,
            "hostname": hostname,
            "netlifySiteId": site.get("id"),
            "builderSource": rendered.get("source"),
            "builderNote": rendered.get("note"),
            "message": rendered.get("note"),
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "projectId": project_id, "message": str(exc)}
