import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { dashboardData, HttpError, invoiceDetail, mutate } from '../src/lib/service';
import { entrySchema, registrationSchema } from '../src/lib/validation';
const temporary=mkdtempSync(join(tmpdir(),'freeladash-test-'));
process.env.DATABASE_PATH=join(temporary,'test.sqlite');
after(()=>{db().close();for(const file of ['test.sqlite','test.sqlite-shm','test.sqlite-wal']){const path=join(temporary,file);if(existsSync(path))unlinkSync(path);}rmdirSync(temporary);});

test('validação, isolamento e ciclo completo de cobrança',async t=>{
  const alice=randomUUID(),bob=randomUUID();
  db().prepare('INSERT INTO users(id,name,email) VALUES(?,?,?)').run(alice,'Alice','alice@example.com');
  db().prepare('INSERT INTO users(id,name,email) VALUES(?,?,?)').run(bob,'Bob','bob@example.com');
  const client=mutate(alice,'clients','POST',undefined,{name:'Cliente teste',email:'cliente@example.com',hourly_rate:12500}) as {id:string};
  const project=mutate(alice,'projects','POST',undefined,{name:'Projeto teste',client_id:client.id}) as {id:string};
  const entry=mutate(alice,'entries','POST',undefined,{project_id:project.id,description:'Implementação',date:'2026-10-12',minutes:95}) as {id:string};
  await t.test('rejeita datas inexistentes, horas fracionadas e registros maiores que 24h',()=>{
    for(const value of [{date:'2026-02-30',minutes:60},{date:'2026-10-12',minutes:1441},{date:'2026-10-12',minutes:60.5}])assert.equal(entrySchema.safeParse({...value,project_id:project.id,description:'Teste'}).success,false);
    assert.equal(registrationSchema.safeParse({name:'Teste',email:'teste@example.com',password:'🔐'.repeat(20)}).success,false);
  });
  await t.test('não permite acessar nem vincular dados de outro usuário',()=>{
    const empty=dashboardData(bob,{month:'2026-10'});
    for(const resource of ['clients','projects','entries','invoices'] as const)assert.deepEqual(empty[resource],[]);
    assert.throws(()=>mutate(bob,'clients','PATCH',client.id,{name:'Outro cliente',email:'outro@example.com',hourly_rate:10000}),e=>e instanceof HttpError&&e.status===404);
    assert.throws(()=>mutate(bob,'projects','POST',undefined,{name:'Projeto alheio',client_id:client.id}),e=>e instanceof HttpError&&e.status===404);
    assert.throws(()=>mutate(bob,'entries','POST',undefined,{project_id:project.id,description:'Teste',date:'2026-10-12',minutes:60}),e=>e instanceof HttpError&&e.status===404);
  });
  await t.test('alterar tarifa preserva o valor do trabalho já registrado',()=>{
    mutate(alice,'clients','PATCH',client.id,{name:'Cliente teste',email:'cliente@example.com',hourly_rate:25000});
    assert.equal(dashboardData(alice).entries[0].hourly_rate,12500);
  });
  let invoice:string;
  await t.test('gera total em centavos e bloqueia cobrança duplicada',()=>{
    invoice=(mutate(alice,'invoices','POST',undefined,{client_id:client.id,start_date:'2026-10-01',end_date:'2026-10-31'}) as {id:string}).id;
    const detail=invoiceDetail(alice,invoice);
    assert.equal(detail.invoice.status,'pending');
    assert.equal(detail.invoice.total,19792);assert.equal(detail.invoice.minutes,95);assert.equal(detail.items.length,1);
    assert.equal(dashboardData(alice).entries[0].invoice_id,invoice);
    assert.throws(()=>mutate(alice,'invoices','POST',undefined,{client_id:client.id,start_date:'2026-10-01',end_date:'2026-10-31'}),e=>e instanceof HttpError&&e.status===409);
    assert.equal(dashboardData(alice).invoices.length,1);
    const data=dashboardData(alice,{month:'2026-10'});
    for(const resource of ['clients','projects','entries','invoices'] as const)for(const row of data[resource])assert.equal(Object.getPrototypeOf(row),Object.prototype,'Rows passed to React must be plain objects');
  });
  await t.test('altera entre todos os status sem modificar o relatório ou permitir acesso alheio',()=>{
    const before=invoiceDetail(alice,invoice);
    for(const status of ['draft','pending','paid','draft','paid','pending']) {
      mutate(alice,'invoices','PATCH',invoice,{status});
      assert.deepEqual(invoiceDetail(alice,invoice),{...before,invoice:{...before.invoice,status}});
      assert.equal(dashboardData(alice).entries.find(e=>e.id===entry.id)?.invoice_id,invoice);
    }
    assert.throws(()=>mutate(bob,'invoices','PATCH',invoice,{status:'draft'}),e=>e instanceof HttpError&&e.status===404);
    for(const input of [{status:'cancelled'},{status:''},{}, {status:null}]) {
      assert.throws(()=>mutate(alice,'invoices','PATCH',invoice,input));
      assert.equal(invoiceDetail(alice,invoice).invoice.status,'pending');
    }
  });
  await t.test('gera rascunho e preserva proteção das horas e bloqueio de duplicação',()=>{
    const draftEntry=mutate(alice,'entries','POST',undefined,{project_id:project.id,description:'Serviço em rascunho',date:'2026-09-12',minutes:60}) as {id:string};
    const input={client_id:client.id,start_date:'2026-09-01',end_date:'2026-09-30',status:'draft'};
    const draft=mutate(alice,'invoices','POST',undefined,input) as {id:string};
    const detail=invoiceDetail(alice,draft.id);
    assert.equal(detail.invoice.status,'draft');
    assert.equal(detail.invoice.total,25000);
    assert.equal(detail.items.length,1);
    assert.equal(dashboardData(alice,{month:'2026-09'}).entries.find(e=>e.id===draftEntry.id)?.invoice_id,draft.id);
    assert.throws(()=>mutate(alice,'invoices','POST',undefined,input),e=>e instanceof HttpError&&e.status===409);
    assert.throws(()=>mutate(alice,'entries','DELETE',draftEntry.id,null),e=>e instanceof HttpError&&e.status===409);
    assert.throws(()=>mutate(alice,'entries','PATCH',draftEntry.id,{project_id:project.id,description:'Alterado',date:'2026-09-12',minutes:30}),e=>e instanceof HttpError&&e.status===409);
  });
  await t.test('protege registros cobrados e snapshots do relatório',()=>{
    assert.throws(()=>mutate(alice,'entries','DELETE',entry.id,null),e=>e instanceof HttpError&&e.status===409);
    assert.throws(()=>mutate(alice,'entries','PATCH',entry.id,{project_id:project.id,description:'Alterado',date:'2026-10-12',minutes:1}),e=>e instanceof HttpError&&e.status===409);
    assert.throws(()=>invoiceDetail(bob,invoice),e=>e instanceof HttpError&&e.status===404);
    mutate(alice,'clients','PATCH',client.id,{name:'Novo nome',email:'novo@example.com',hourly_rate:30000});
    mutate(alice,'projects','PATCH',project.id,{name:'Novo projeto',client_id:client.id,status:'completed'});
    const detail=invoiceDetail(alice,invoice);assert.equal(detail.invoice.client_name,'Cliente teste');assert.equal(detail.items[0].project_name,'Projeto teste');
    mutate(alice,'invoices','PATCH',invoice,{status:'paid'});assert.equal(invoiceDetail(alice,invoice).invoice.status,'paid');
  });
});
