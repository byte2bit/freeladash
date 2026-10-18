import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("rota de atualização faz parte das fontes e não é ignorada como banco de dados", t=>{
  assert.match(readFileSync("src/app/api/data/route.ts","utf8"),/export async function GET/);
  try { execFileSync("git",["rev-parse","--show-toplevel"],{stdio:"pipe"}); }
  catch { t.skip("Sem metadados Git neste pacote.");return; }
  const route=spawnSync("git",["check-ignore","--no-index","-q","--","src/app/api/data/route.ts"]);
  assert.equal(route.status,1,"o endpoint não pode ser ignorado");
  const database=spawnSync("git",["check-ignore","--no-index","-q","--","data/freeladash.sqlite"]);
  assert.equal(database.status,0,"o banco local deve continuar ignorado");
});
