import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { dashboardData, catalogData, invoicePreview } from "../src/lib/dashboard-data";
import { mutate } from "../src/lib/service";

const temporary=mkdtempSync(join(tmpdir(),"freeladash-pages-"));
process.env.DATABASE_PATH=join(temporary,"test.sqlite");
after(()=>{db().close();rmSync(temporary,{recursive:true,force:true});});

test("paginação limita payload sem truncar totais, busca, gráficos, seletores ou prévia de cobrança",()=>{
  const user=randomUUID(),other=randomUUID();
  for(const id of [user,other])db().prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(id,"Test",`${id}@example.com`);
  const client=mutate(user,"clients","POST",undefined,{name:"Cliente principal",email:"test@example.com",hourly_rate:10000});
  assert.ok('id' in client);
  const project=mutate(user,"projects","POST",undefined,{name:"Projeto principal",client_id:client.id});
  assert.ok('id' in project);
  for(let i=0;i<125;i++)mutate(user,"entries","POST",undefined,{project_id:project.id,description:`Registro ${i.toString().padStart(3,'0')}`,date:"2026-10-12",minutes:60});
  mutate(user,"entries","POST",undefined,{project_id:project.id,description:"Outro mês",date:"2026-09-12",minutes:30});
  for(let i=0;i<55;i++){
    const c=mutate(user,"clients","POST",undefined,{name:`Cliente ${i.toString().padStart(2,'0')}`,email:`client${i}@example.com`,hourly_rate:10000});
    assert.ok('id' in c);
    mutate(user,"projects","POST",undefined,{name:`Projeto ${i.toString().padStart(2,'0')}`,client_id:c.id});
  }
  const first=dashboardData(user,{month:"2026-10",view:"entries"});
  const second=dashboardData(user,{month:"2026-10",view:"entries",page:2});
  const last=dashboardData(user,{month:"2026-10",view:"entries",page:3});
  assert.deepEqual([first.entries.length,second.entries.length,last.entries.length],[50,50,25]);
  assert.equal(new Set([...first.entries,...second.entries,...last.entries].map(e=>e.id)).size,125);
  assert.equal(first.clients.length,50);assert.equal(first.projects.length,50);
  assert.equal(first.summary.monthMinutes,7500);assert.equal(first.summary.monthAmount,1250000);
  assert.equal(first.summary.weekHours.reduce((a,b)=>a+b,0),125);
  assert.equal(first.summary.clientTotals[0].minutes,7500);
  assert.equal(first.summary.activeProjects,56);assert.equal(first.summary.clientCount,56);
  assert.equal(last.summary.entryMinutes,7500);
  const found=dashboardData(user,{month:"2026-10",view:"entries",q:"Registro 124"});
  assert.equal(found.entries.length,1);assert.equal(found.summary.entryMinutes,60);
  const clientFound=dashboardData(user,{month:"2026-10",view:"clients",q:"principal"});
  assert.equal(clientFound.clients[0].project_count,1);assert.equal(clientFound.clients[0].month_minutes,7500);
  const projectFound=dashboardData(user,{month:"2026-10",view:"projects",q:"principal"});
  assert.equal(projectFound.projects[0].entry_count,126);assert.equal(projectFound.projects[0].minutes,7530);
  const catalog=catalogData(user,{resource:"projects",q:"principal"});
  assert.equal(catalog.items.length,1);assert.equal(catalog.items[0].id,project.id);
  assert.equal(catalogData(user,{resource:"clients",page:2}).items.length,6);
  const preview={client_id:client.id,start_date:"2026-10-01",end_date:"2026-10-31"};
  assert.deepEqual(invoicePreview(user,preview),{count:125,minutes:7500,amount:1250000});
  assert.deepEqual(invoicePreview(other,preview),{count:0,minutes:0,amount:0});
  assert.equal(dashboardData(other,{month:"2026-10"}).entries.length,0);
  assert.equal(dashboardData(user,{month:"2026-10",view:"entries",page:9999}).pagination.entries.page,3);
  assert.throws(()=>dashboardData(user,{month:"2026-13"}));
  assert.throws(()=>dashboardData(user,{page:-1}));
  mutate(user,"invoices","POST",undefined,preview);
  assert.equal(invoicePreview(user,preview).count,0);
  assert.equal(dashboardData(user,{month:"2026-10",view:"entries",status:"unbilled"}).entries.length,0);
  mutate(user,"clients","POST",undefined,{name:"Ágata",email:"agata@example.com",hourly_rate:10000});
  assert.equal(dashboardData(user,{month:"2026-10",view:"clients",q:"ágata"}).clients[0].name,"Ágata");
  assert.equal(catalogData(user,{resource:"clients",q:"ÁGATA"}).items[0].name,"Ágata");
});

test("consultas por vínculo usam índices, inclusive em conexão reutilizada",()=>{
  const queries=[
    ["SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY date","invoice_items_invoice_date"],
    ["SELECT id FROM time_entries WHERE project_id=? LIMIT 1","entries_project"],
    ["SELECT id FROM projects WHERE client_id=? LIMIT 1","projects_client"],
    ["SELECT id FROM timer_sessions WHERE project_id=? AND stopped_at IS NULL","timer_project_active"],
  ];
  for(const [sql,index] of queries){
    const plan=db().prepare(`EXPLAIN QUERY PLAN ${sql}`).all("unused").map(row=>String(row.detail)).join(";");
    assert.ok(plan.includes("SEARCH")&&plan.includes(index),plan);
  }
  db().exec("DROP INDEX entries_project");
  (globalThis as {freelaSchemaVersion?:number}).freelaSchemaVersion=2;
  assert.ok(db().prepare("SELECT name FROM sqlite_master WHERE name='entries_project'").get());
});
