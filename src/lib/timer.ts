import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { HttpError } from "./service";
import type { Timer } from "./types";
import { timerSchema } from "./validation";
import { timerModel } from "./models";

export function activeTimer(user: string): Timer | null {
  const row = db().prepare(`SELECT t.id, t.project_id, t.description, t.started_at,
    p.name project_name, c.name client_name, c.color FROM timer_sessions t
    JOIN projects p ON p.id=t.project_id JOIN clients c ON c.id=p.client_id
    WHERE t.user_id=? AND t.stopped_at IS NULL`).get(user);
  return row ? timerModel.parse(row) : null;
}

export function startTimer(user: string, input: unknown) {
  const value = timerSchema.parse(input);
  return transaction(() => {
    const previous = db().prepare("SELECT * FROM timer_sessions WHERE id=?").get(value.id);
    if (previous) {
      if (previous.user_id !== user) throw new HttpError(404, "Timer não encontrado.");
      if (previous.stopped_at !== null) throw new HttpError(409, "Este timer já foi salvo. Inicie um novo timer.");
      return activeTimer(user)!; // Retrying START after a network failure is safe.
    }
    if (activeTimer(user)) throw new HttpError(409, "Você já tem um timer em andamento. Pare-o antes de iniciar outro.");
    const project = db().prepare(`SELECT p.status, c.hourly_rate FROM projects p
      JOIN clients c ON c.id=p.client_id WHERE p.id=? AND p.user_id=? AND c.user_id=?`).get(value.project_id, user, user);
    if (!project) throw new HttpError(404, "Projeto não encontrado.");
    if (project.status !== "active") throw new HttpError(409, "Selecione um projeto ativo.");
    db().prepare("INSERT INTO timer_sessions(id,user_id,project_id,description,started_at,hourly_rate) VALUES(?,?,?,?,?,?)")
      .run(value.id, user, value.project_id, value.description, Date.now(), project.hourly_rate);
    return activeTimer(user)!;
  });
}

// Dates follow the same São Paulo timezone used throughout the dashboard.
export function timerDays(start: number, end: number) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const result: { date: string; minutes: number }[] = [];
  let cursor = start;
  do {
    const date = format.format(new Date(cursor));
    // São Paulo has used UTC-03 year-round since 2019.
    const midnight = new Date(`${date}T00:00:00-03:00`).getTime() + 86400000;
    const segmentEnd = Math.min(end, midnight);
    result.push({ date, minutes: Math.max(1, Math.ceil((segmentEnd - cursor) / 60000)) });
    cursor = segmentEnd;
  } while (cursor < end);
  return result;
}

export function stopTimer(user: string, id: string) {
  return transaction(() => {
    const timer = db().prepare("SELECT * FROM timer_sessions WHERE id=? AND user_id=?").get(id, user);
    if (!timer) throw new HttpError(404, "Timer não encontrado.");
    if (timer.stopped_at !== null) return { ids: JSON.parse(String(timer.entry_ids)) as string[] };
    const stoppedAt = Math.max(Number(timer.started_at), Date.now());
    const ids = timerDays(Number(timer.started_at), stoppedAt).map(day => {
      const key = randomUUID();
      db().prepare("INSERT INTO time_entries(id,user_id,project_id,description,date,minutes,hourly_rate) VALUES(?,?,?,?,?,?,?)")
        .run(key, user, timer.project_id, timer.description, day.date, day.minutes, timer.hourly_rate);
      return key;
    });
    db().prepare("UPDATE timer_sessions SET stopped_at=?,entry_ids=? WHERE id=? AND user_id=?").run(stoppedAt, JSON.stringify(ids), id, user);
    return { ids };
  });
}
