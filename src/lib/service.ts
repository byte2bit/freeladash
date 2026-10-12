import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { entryAmount } from "./format";
import type { DashboardData, Entry, Invoice } from "./types";
import { clientSchema, projectSchema, entrySchema, invoiceSchema } from "./validation";
import { z } from "zod";
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function dashboardData(user: string): DashboardData {
  return {
    // node:sqlite returns null-prototype rows. React Server Components require plain objects.
    clients: db().prepare("SELECT * FROM clients WHERE user_id=? ORDER BY name").all(user).map(row=>({...row})),
    projects: db().prepare("SELECT p.*, c.name client_name, c.color, c.hourly_rate FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.user_id=? ORDER BY p.created_at DESC, p.name").all(user).map(row=>({...row})),
    entries: db().prepare("SELECT t.*, p.name project_name, c.name client_name, c.id client_id, c.color FROM time_entries t JOIN projects p ON p.id=t.project_id JOIN clients c ON c.id=p.client_id WHERE t.user_id=? ORDER BY t.date DESC, t.created_at DESC").all(user).map(row=>({...row})),
    invoices: db().prepare("SELECT * FROM invoices WHERE user_id=? ORDER BY created_at DESC").all(user).map(row=>({...row})),
  } as unknown as DashboardData;
}
function owned(table: string, id: string, user: string) {
  // table is always a literal from our own code, never request input.
  const row = db().prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(id,user);
  if (!row) throw new HttpError(404,"Registro não encontrado.");
  return row;
}
export function mutate(user: string, resource: string, method: string, id: string | undefined, input: unknown) {
  if (!['clients','projects','entries','invoices'].includes(resource)) throw new HttpError(404,"Recurso não encontrado.");
  const table = resource === 'entries' ? 'time_entries' : resource;
  if (method !== 'POST' && !id) throw new HttpError(400,"Informe o registro.");
  return transaction(() => {
    const existing = id ? owned(table,id,user) : null;
    if (resource === 'entries' && existing?.invoice_id) throw new HttpError(409,"Este registro já faz parte de uma cobrança.");
    if (method === 'DELETE') {
      if (resource === 'invoices') throw new HttpError(405,"Cobranças emitidas não podem ser excluídas.");
      const refs = resource === 'clients' ? db().prepare("SELECT id FROM projects WHERE client_id=? LIMIT 1").get(id!) : resource === 'projects' ? db().prepare("SELECT id FROM time_entries WHERE project_id=? LIMIT 1").get(id!) : null;
      if (refs) throw new HttpError(409,"Este registro possui vínculos. Mantenha-o para preservar seu histórico.");
      db().prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(id!, user);
      return { success: true };
    }
    const key = id || randomUUID();
    if (resource === 'clients') {
      const v=clientSchema.parse(input);
      if (method==='POST') db().prepare("INSERT INTO clients(id,user_id,name,email,hourly_rate,color) VALUES(?,?,?,?,?,?)").run(key,user,v.name,v.email,v.hourly_rate,v.color);
      else db().prepare("UPDATE clients SET name=?,email=?,hourly_rate=?,color=? WHERE id=? AND user_id=?").run(v.name,v.email,v.hourly_rate,v.color,key,user);
    } else if (resource === 'projects') {
      const v=projectSchema.parse(input); owned('clients',v.client_id,user);
      if (existing && existing.client_id !== v.client_id && db().prepare("SELECT id FROM time_entries WHERE project_id=? LIMIT 1").get(key)) throw new HttpError(409,"Projetos com horas registradas não podem trocar de cliente.");
      if (method==='POST') db().prepare("INSERT INTO projects(id,user_id,client_id,name,status) VALUES(?,?,?,?,?)").run(key,user,v.client_id,v.name,v.status);
      else db().prepare("UPDATE projects SET name=?,client_id=?,status=? WHERE id=? AND user_id=?").run(v.name,v.client_id,v.status,key,user);
    } else if (resource === 'entries') {
      const v=entrySchema.parse(input); const project=owned('projects',v.project_id,user);
      if (project.status!=='active') throw new HttpError(409,"Selecione um projeto ativo.");
      const client=owned('clients',String(project.client_id),user);
      const rate=existing && existing.project_id===v.project_id ? Number(existing.hourly_rate) : Number(client.hourly_rate);
      if (method==='POST') db().prepare("INSERT INTO time_entries(id,user_id,project_id,description,date,minutes,hourly_rate) VALUES(?,?,?,?,?,?,?)").run(key,user,v.project_id,v.description,v.date,v.minutes,rate);
      else db().prepare("UPDATE time_entries SET project_id=?,description=?,date=?,minutes=?,hourly_rate=? WHERE id=? AND user_id=?").run(v.project_id,v.description,v.date,v.minutes,rate,key,user);
    } else if (method === 'PATCH') {
      const v=z.object({ status:z.enum(['pending','paid']) }).parse(input);
      db().prepare("UPDATE invoices SET status=? WHERE id=? AND user_id=?").run(v.status,key,user);
    } else {
      const v=invoiceSchema.parse(input); const client=owned('clients',v.client_id,user);
      const entries=db().prepare("SELECT t.*, p.name project_name FROM time_entries t JOIN projects p ON p.id=t.project_id WHERE t.user_id=? AND p.client_id=? AND t.date BETWEEN ? AND ? AND t.invoice_id IS NULL ORDER BY t.date").all(user,v.client_id,v.start_date,v.end_date) as unknown as Entry[];
      if (!entries.length) throw new HttpError(409,"Nenhuma hora disponível para cobrar neste período.");
      const count=Number(db().prepare("SELECT COUNT(*) n FROM invoices WHERE user_id=?").get(user)!.n)+1;
      const number=`FD-${String(count).padStart(4,'0')}`;
      const total=entries.reduce((sum,e)=>sum+entryAmount(e.minutes,e.hourly_rate),0);
      const minutes=entries.reduce((sum,e)=>sum+e.minutes,0);
      db().prepare("INSERT INTO invoices(id,user_id,client_id,number,start_date,end_date,total,minutes,client_name,client_email) VALUES(?,?,?,?,?,?,?,?,?,?)").run(key,user,v.client_id,number,v.start_date,v.end_date,total,minutes,String(client.name),String(client.email));
      for (const e of entries) {
        db().prepare("INSERT INTO invoice_items(id,invoice_id,project_name,description,date,minutes,hourly_rate,amount) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(),key,e.project_name,e.description,e.date,e.minutes,e.hourly_rate,entryAmount(e.minutes,e.hourly_rate));
        db().prepare("UPDATE time_entries SET invoice_id=? WHERE id=? AND user_id=?").run(key,e.id,user);
      }
    }
    return { id: key };
  });
}
export function invoiceDetail(user: string,id: string) { return { invoice: owned('invoices',id,user) as unknown as Invoice, items: db().prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY date").all(id) }; }
