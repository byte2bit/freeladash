import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { authSecret } from "./auth-secret";
import { allowAuth, db, transaction } from "./db";
import { comparePassword, hashPassword, PasswordBusyError } from "./password";
import { loginSchema, registrationSchema } from "./validation";
import { HttpError } from "./service";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

// Auth.js issues a signed, HttpOnly CSRF cookie. Never trust arbitrary client IDs.
export function authClient(request: Request, requireToken = false): string {
  const secret = authSecret();
  if (!secret) throw new HttpError(503, "Autenticação indisponível.");
  const name = new URL(process.env.AUTH_URL || request.url).protocol === "https:" ? "__Host-authjs.csrf-token" : "authjs.csrf-token";
  const raw = request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  let value = "";
  try { value = decodeURIComponent(raw || ""); } catch { /* Invalid cookie is rejected below. */ }
  const [token, signature] = value.split("|");
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !signature || !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(digest(token + secret), "hex")) ||
    (requireToken && request.headers.get("x-csrf-token") !== token)) {
    throw new HttpError(403, "Recarregue a página de login e tente novamente.");
  }
  return digest(token);
}

function trustedAddress(request: Request): string | null {
  // Opt in only when a trusted reverse proxy overwrites this exact header.
  const header = process.env.AUTH_RATE_LIMIT_IP_HEADER?.trim();
  if (!header) return null;
  const value = request.headers.get(header)?.trim();
  if (!value || !isIP(value)) throw new HttpError(503, "Origem de autenticação indisponível.");
  return digest(value);
}
export function authBudget(request: Request, action: "login" | "register", email: string, requireToken = false) {
  const client = authClient(request, requireToken);
  const ip = trustedAddress(request);
  const allowed = transaction(() => {
    if (ip && !allowAuth(`${action}:ip:${ip}`, 60)) return false;
    if (!allowAuth(`${action}:client:${client}`, action === "login" ? 30 : 10)) return false;
    return allowAuth(`${action}:account:${client}:${digest(email)}`, action === "login" ? 10 : 3);
  });
  if (!allowed) throw new HttpError(429, "Muitas tentativas neste dispositivo. Aguarde 15 minutos.");
}

export async function registerAccount(request: Request, input: unknown) {
  authClient(request, true);
  const value = registrationSchema.parse(input);
  authBudget(request, "register", value.email, true);
  if (db().prepare("SELECT id FROM users WHERE email=?").get(value.email)) throw new HttpError(409, "Não foi possível criar a conta com este email.");
  const hash = await hashPassword(value.password);
  return transaction(() => {
    if (db().prepare("SELECT id FROM users WHERE email=?").get(value.email)) throw new HttpError(409, "Não foi possível criar a conta com este email.");
    const id = randomUUID();
    db().prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)").run(id, value.name, value.email, hash);
    return { id };
  });
}

export async function authorizeCredentials(input: unknown, request: Request) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;
  try { authBudget(request, "login", parsed.data.email); }
  catch (error) { if (error instanceof HttpError) return null; throw error; }
  const user = db().prepare("SELECT id,name,email,password_hash,google_sub FROM users WHERE email=?").get(parsed.data.email);
  const hash = String(user?.password_hash || "$2b$12$LQv3c1yqBWVHxkd0LHAkCOY7ev.2NPvqWOlDQJgz5CknOJLKIHBKa");
  let valid: boolean;
  try { valid = await comparePassword(parsed.data.password, hash); }
  catch (error) { if (error instanceof PasswordBusyError) return null; throw error; }
  // Previously merged accounts are Google-only; an old local password grants no access.
  if (!user?.password_hash || user.google_sub || !valid) return null;
  return { id: String(user.id), name: String(user.name), email: String(user.email) };
}

export function googleUser(input: { email?: string | null; name?: string | null; sub?: unknown; verified?: unknown }): string | null {
  if (input.verified !== true || typeof input.sub !== "string" || !input.sub || !input.email) return null;
  const email = input.email.toLowerCase();
  return transaction(() => {
    const linked = db().prepare("SELECT id FROM users WHERE google_sub=?").get(input.sub as string);
    if (linked) return String(linked.id);
    // Email equality alone never authorizes linking to a pre-existing local identity.
    if (db().prepare("SELECT id FROM users WHERE email=?").get(email)) return null;
    const id = randomUUID();
    db().prepare("INSERT INTO users(id,name,email,google_sub) VALUES(?,?,?,?)").run(id, input.name || "Freelancer", email, input.sub as string);
    return id;
  });
}

export function validAuthSession(userId: unknown, provider: unknown): boolean {
  if (typeof userId !== "string" || (provider !== "credentials" && provider !== "google")) return false;
  const user = db().prepare("SELECT password_hash,google_sub FROM users WHERE id=?").get(userId);
  return Boolean(user && (provider === "google" ? user.google_sub : user.password_hash && !user.google_sub));
}
