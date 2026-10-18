import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function authSecret(): string | undefined {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") return undefined;
  mkdirSync(resolve("data"), { recursive: true });
  const path = resolve("data/.auth-secret");
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32).toString("hex"), { flag: "wx" }); }
    catch (error) { if (!existsSync(path)) throw error; }
  }
  return readFileSync(path, "utf8").trim();
}
