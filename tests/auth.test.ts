import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { authBudget, authClient, authorizeCredentials, googleUser, registerAccount, validAuthSession } from "../src/lib/auth-security";
import { hashPassword, comparePassword } from "../src/lib/password";
import { HttpError } from "../src/lib/service";

const temporary = mkdtempSync(join(tmpdir(), "freeladash-auth-"));
process.env.DATABASE_PATH = join(temporary, "test.sqlite");
process.env.AUTH_SECRET = randomBytes(32).toString("hex");
after(() => { db().close(); rmSync(temporary, { recursive: true, force: true }); });
function client(ip?: string) {
  const token = randomBytes(32).toString("hex");
  const signature = createHash("sha256").update(token + process.env.AUTH_SECRET).digest("hex");
  return new Request("http://localhost:3000/api/register", { headers: {
    cookie: `authjs.csrf-token=${encodeURIComponent(`${token}|${signature}`)}`,
    "x-csrf-token": token, ...(ip ? { "x-real-ip": ip } : {}),
  } });
}
const password = "Regression-test-123";

test("Google não associa email local; contas antigas vinculadas não aceitam senha nem sessão de credenciais", async () => {
  const input = { name: "Local", email: "local@example.com", password };
  const { id } = await registerAccount(client(), input);
  assert.equal(googleUser({ email: input.email, sub: "attacker-collision", verified: true }), null);
  assert.equal(db().prepare("SELECT google_sub FROM users WHERE id=?").get(id)?.google_sub, null);
  assert.equal((await authorizeCredentials(input, client()))?.id, id);
  db().prepare("UPDATE users SET google_sub=? WHERE id=?").run("legacy-google", id);
  assert.equal(await authorizeCredentials(input, client()), null);
  assert.equal(validAuthSession(id, "credentials"), false);
  assert.equal(validAuthSession(id, undefined), false);
  assert.equal(validAuthSession(id, "google"), true);
  assert.equal(googleUser({ email: input.email, sub: "legacy-google", verified: true }), id);
  assert.equal(googleUser({ email: "fresh@example.com", sub: "fresh", verified: false }), null);
  const fresh = googleUser({ email: "fresh@example.com", sub: "fresh", verified: true });
  assert.ok(fresh);
  assert.equal(googleUser({ email: "changed@example.com", sub: "fresh", verified: true }), fresh);
});

test("cliente abusivo não bloqueia cadastro nem senha correta de outro dispositivo", async () => {
  const bad = client();
  for (let i = 0; i < 10; i++) await assert.rejects(registerAccount(bad, {}));
  const input = { name: "Outra conta", email: "independent@example.com", password };
  const { id } = await registerAccount(client(), input);
  for (let i = 0; i < 10; i++) authBudget(bad, "login", input.email);
  assert.throws(() => authBudget(bad, "login", input.email), error => error instanceof HttpError && error.status === 429);
  assert.equal(await authorizeCredentials(input, bad), null);
  assert.equal((await authorizeCredentials(input, client()))?.id, id);
  assert.equal(db().prepare("SELECT count(*) n FROM auth_attempts WHERE key='register:global'").get()?.n, 0);
});

test("cookies falsos e IPs não confiáveis não definem identidade; proxy explícito limita rotação de clientes", () => {
  assert.throws(() => authClient(new Request("http://localhost:3000", { headers: { cookie: "authjs.csrf-token=forged|fake" } })), error => error instanceof HttpError && error.status === 403);
  const previous = process.env.AUTH_RATE_LIMIT_IP_HEADER;
  try {
    process.env.AUTH_RATE_LIMIT_IP_HEADER = "x-real-ip";
    for (let i = 0; i < 60; i++) authBudget(client("192.0.2.1"), "login", `user${i}@example.com`);
    assert.throws(() => authBudget(client("192.0.2.1"), "login", "next@example.com"), error => error instanceof HttpError && error.status === 429);
    assert.doesNotThrow(() => authBudget(client("192.0.2.2"), "login", "next@example.com"));
    assert.throws(() => authBudget(client("not-an-ip"), "login", "next@example.com"));
  } finally { if (previous === undefined) delete process.env.AUTH_RATE_LIMIT_IP_HEADER; else process.env.AUTH_RATE_LIMIT_IP_HEADER = previous; }
});

test("bcrypt funciona em worker, mantendo event loop responsivo e compatibilidade com hashes", async () => {
  let ticks = 0;
  const interval = setInterval(() => { ticks++; }, 5);
  try {
    const hash = await hashPassword(password);
    assert.ok(ticks > 0, "hash caro não deve impedir callbacks do processo principal");
    assert.equal(await comparePassword(password, hash), true);
    assert.equal(await comparePassword("wrong-password", hash), false);
  } finally { clearInterval(interval); }
});
