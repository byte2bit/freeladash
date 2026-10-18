import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export class PasswordBusyError extends Error {
  constructor() { super("Muitas solicitações. Tente novamente em instantes."); }
}

// Fixed, trusted worker code. Passwords are passed as data, never interpolated.
const workerSource = `
  const { parentPort, workerData } = require('node:worker_threads');
  const bcrypt = require(workerData.modulePath);
  try {
    const value = workerData.operation === 'hash'
      ? bcrypt.hashSync(workerData.password, 12)
      : bcrypt.compareSync(workerData.password, workerData.hash);
    parentPort.postMessage({ value });
  } catch { parentPort.postMessage({ error: true }); }
  parentPort.close();
`;
type Job = { operation: "hash" | "compare"; password: string; hash?: string; resolve: (value: string | boolean) => void; reject: (error: Error) => void };
let active = 0;
const waiting: Job[] = [];

function drain() {
  while (active < 2 && waiting.length) {
    const job = waiting.shift()!;
    active++;
    let worker: Worker;
    try {
      const modulePath = createRequire(resolve("package.json")).resolve("bcryptjs");
      worker = new Worker(workerSource, { eval: true, workerData: { operation: job.operation, password: job.password, hash: job.hash, modulePath } });
    } catch (error) { active--; job.reject(error instanceof Error ? error : new Error("Falha no serviço de senhas.")); continue; }
    let settled = false;
    const finish = (error?: Error, value?: string | boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (error) job.reject(error); else job.resolve(value!);
      // Keep the concurrency slot until the worker has actually stopped.
      void worker.terminate().finally(() => { active--; drain(); });
    };
    const timeout = setTimeout(() => finish(new PasswordBusyError()), 15000);
    worker.once("message", (message: { value?: string | boolean; error?: boolean }) => {
      if (message.error || (typeof message.value !== "string" && typeof message.value !== "boolean")) finish(new Error("Falha no serviço de senhas."));
      else finish(undefined, message.value);
    });
    worker.once("error", error => finish(error));
    worker.once("exit", () => { if (!settled) finish(new Error("Serviço de senhas interrompido.")); });
  }
}
function run(operation: Job["operation"], password: string, hash?: string) {
  if (waiting.length >= 16) return Promise.reject(new PasswordBusyError());
  return new Promise<string | boolean>((resolve, reject) => { waiting.push({ operation, password, hash, resolve, reject }); drain(); });
}
export async function hashPassword(password: string): Promise<string> {
  const value = await run("hash", password);
  if (typeof value !== "string") throw new Error("Hash inválido.");
  return value;
}
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return (await run("compare", password, hash)) === true;
}
