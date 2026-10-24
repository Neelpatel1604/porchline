import { config } from "dotenv";
import path from "path";

let loaded = false;

export function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

export function loadRootEnv(): void {
  if (loaded) return;
  config({ path: path.join(repoRoot(), ".env") });
  loaded = true;
}

export function missingEnv(names: string[]): string | null {
  loadRootEnv();
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) return null;
  return `Missing ${missing.join(", ")}`;
}
