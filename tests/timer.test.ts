import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { dashboardData, HttpError, mutate } from "../src/lib/service";
import { activeTimer, startTimer, stopTimer, timerDays } from "../src/lib/timer";

const temporary = mkdtempSync(join(tmpdir(), "freeladash-timer-"));
process.env.DATABASE_PATH = join(temporary, "test.sqlite");
after(() => {
  db().close();
  for (const file of ["test.sqlite", "test.sqlite-shm", "test.sqlite-wal"]) {
    const path = join(temporary, file); if (existsSync(path)) unlinkSync(path);
  }
  rmdirSync(temporary);
});

test("timer persistente, isolado por usuário e salvamento sem duplicação", async t => {
  let now = new Date("2026-10-14T10:00:00-03:00").getTime();
  t.mock.method(Date, "now", () => now);
  const user = randomUUID(), other = randomUUID();
  for (const id of [user, other]) db().prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(id, "Teste timer", `${id}@example.com`);
  const client = mutate(user, "clients", "POST", undefined, { name: "Cliente timer", email: "timer@example.com", hourly_rate: 12000 }) as { id: string };
  const project = mutate(user, "projects", "POST", undefined, { name: "Projeto timer", client_id: client.id }) as { id: string };
  const input = { id: randomUUID(), project_id: project.id, description: "Desenvolvimento da página" };
  await t.test("aplica a nova tabela mesmo reutilizando uma conexão aberta antes da atualização", () => {
    db().exec("DROP TABLE timer_sessions");
    (globalThis as unknown as { freelaSchemaVersion?: number }).freelaSchemaVersion = undefined;
    assert.equal(activeTimer(user), null);
    assert.ok(db().prepare("SELECT name FROM sqlite_master WHERE name='timer_user_active'").get());
  });
  await t.test("valida descrição e propriedade do projeto antes de iniciar", () => {
    assert.throws(() => startTimer(user, { ...input, description: " " }));
    assert.throws(() => startTimer(other, input), error => error instanceof HttpError && error.status === 404);
    assert.equal(activeTimer(user), null);
  });
  await t.test("START repetido recupera a mesma sessão; somente um timer por usuário", () => {
    const timer = startTimer(user, input);
    assert.equal(timer.started_at, now);
    assert.equal(timer.description, input.description);
    assert.equal(Object.getPrototypeOf(timer), Object.prototype);
    assert.deepEqual(startTimer(user, input), timer);
    assert.deepEqual(activeTimer(user), timer);
    assert.equal(activeTimer(other), null);
    assert.throws(() => startTimer(user, { ...input, id: randomUUID() }), error => error instanceof HttpError && error.status === 409);
    assert.throws(() => startTimer(other, input), error => error instanceof HttpError && error.status === 404);
    assert.throws(() => stopTimer(other, timer.id), error => error instanceof HttpError && error.status === 404);
  });
  await t.test("protege projeto em andamento e mantém a tarifa do início", () => {
    assert.throws(() => mutate(user, "projects", "DELETE", project.id, null), error => error instanceof HttpError && error.status === 409);
    assert.throws(() => mutate(user, "projects", "PATCH", project.id, { name: "Projeto timer", client_id: client.id, status: "completed" }), error => error instanceof HttpError && error.status === 409);
    mutate(user, "clients", "PATCH", client.id, { name: "Cliente timer", email: "timer@example.com", hourly_rate: 24000 });
  });
  let ids: string[];
  await t.test("STOP calcula duração no servidor, salva e tolera tentativas repetidas", () => {
    now += 95 * 60000 + 1000;
    ids = stopTimer(user, input.id).ids;
    assert.equal(ids.length, 1);
    assert.deepEqual(stopTimer(user, input.id).ids, ids);
    assert.equal(activeTimer(user), null);
    const entries = dashboardData(user).entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].date, "2026-10-14");
    assert.equal(entries[0].minutes, 96);
    assert.equal(entries[0].hourly_rate, 12000);
    assert.throws(() => startTimer(user, input), error => error instanceof HttpError && error.status === 409);
  });
  await t.test("registros do timer podem ser editados, mesmo após concluir o projeto, e excluídos", () => {
    mutate(user, "projects", "PATCH", project.id, { name: "Projeto timer", client_id: client.id, status: "completed" });
    mutate(user, "entries", "PATCH", ids[0], { project_id: project.id, description: "Descrição corrigida", date: "2026-10-14", minutes: 90 });
    assert.equal(dashboardData(user).entries[0].minutes, 90);
    assert.equal(dashboardData(user).entries[0].hourly_rate, 12000);
    assert.throws(() => startTimer(user, { ...input, id: randomUUID() }), error => error instanceof HttpError && error.status === 409);
    mutate(user, "entries", "DELETE", ids[0], null);
    assert.equal(dashboardData(user).entries.length, 0);
  });
  await t.test("sessão passando da meia-noite salva um registro em cada dia", () => {
    mutate(user, "projects", "PATCH", project.id, { name: "Projeto timer", client_id: client.id, status: "active" });
    now = new Date("2026-10-14T23:30:00-03:00").getTime();
    const timer = startTimer(user, { ...input, id: randomUUID() });
    now += 60 * 60000;
    assert.equal(stopTimer(user, timer.id).ids.length, 2);
    assert.deepEqual(dashboardData(user).entries.map(entry => ({ date: entry.date, minutes: entry.minutes })), [
      { date: "2026-10-15", minutes: 30 }, { date: "2026-10-14", minutes: 30 },
    ]);
  });
  await t.test("registro manual permanece disponível ao lado de um timer ativo", () => {
    const timer = startTimer(user, { ...input, id: randomUUID() });
    const manual = mutate(user, "entries", "POST", undefined, { project_id: project.id, description: "Esqueci de ligar o timer", date: "2026-10-15", minutes: 40 }) as { id: string };
    assert.equal(activeTimer(user)?.id, timer.id);
    assert.ok(dashboardData(user).entries.some(entry => entry.id === manual.id && entry.minutes === 40));
    stopTimer(user, timer.id);
    assert.ok(dashboardData(user).entries.some(entry => entry.description === input.description && entry.minutes === 1));
  });
});

test("sessões longas são separadas em dias com duração de até 24 horas", () => {
  const start = new Date("2026-10-14T00:00:00-03:00").getTime();
  assert.deepEqual(timerDays(start, start + 2 * 86400000), [
    { date: "2026-10-14", minutes: 1440 }, { date: "2026-10-15", minutes: 1440 },
  ]);
  assert.deepEqual(timerDays(start, start), [{ date: "2026-10-14", minutes: 1 }]);
});
