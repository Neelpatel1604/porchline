import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env"), override: true });

const key = (process.env.GEMINI_API_KEY || "").trim();
const model = (process.env.SITE_BUILDER_MODEL || "gemini-4-argon").trim();
const profile = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "rose-barber.json"), "utf8"));

console.log("key_len", key.length, "model", model);

const SYSTEM = `You are an elite freelance web designer.
Build a COMPLETE one-page marketing website.
Return ONLY JSON with keys html, css, js.
html must start with <!doctype html>, include <nav>, <footer>, link ./styles.css, and the text Built with Porchline.
Use only facts from the profile.`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const started = Date.now();
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-goog-api-key": key,
  },
  body: JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Build a full one-page website with sticky nav, hero, sections, footer.\n\nProfile JSON:\n" +
              JSON.stringify(profile, null, 2),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 65536,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "medium" },
    },
  }),
});

const raw = await response.text();
console.log("http", response.status, "ms", Date.now() - started);
if (!response.ok) {
  console.log("error", raw.slice(0, 500));
  process.exit(1);
}

const body = JSON.parse(raw);
const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
const finish = body.candidates?.[0]?.finishReason;
console.log("finish", finish, "text_len", text.length);

const start = text.indexOf("{");
const end = text.lastIndexOf("}");
if (start < 0 || end <= start) {
  console.log("no_json", text.slice(0, 300));
  process.exit(1);
}
const parsed = JSON.parse(text.slice(start, end + 1));
const html = parsed.html || "";
const css = parsed.css || "";
console.log("has_doctype", /<!doctype html/i.test(html));
console.log("has_nav", /<nav[\s>]/i.test(html));
console.log("has_footer", /<footer[\s>]/i.test(html));
console.log("has_css_link", html.includes("./styles.css"));
console.log("has_porchline", html.includes("Built with Porchline"));
console.log("html_len", html.length, "css_len", css.length);

const outDir = path.join(root, "data", "gemini-smoke");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.writeFileSync(path.join(outDir, "styles.css"), css);
if (parsed.js) fs.writeFileSync(path.join(outDir, "script.js"), parsed.js);
console.log("wrote", outDir);
