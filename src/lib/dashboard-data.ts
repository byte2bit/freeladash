import type { SQLInputValue } from "node:sqlite";
import { db } from "./db";
import { monthRange, today } from "./format";
import { catalogModel, clientModel, clientTotalModel, dashboardModel, entryModel, invoiceModel, pageModel, previewModel, projectModel } from "./models";
import { catalogQuerySchema, dashboardQuerySchema, previewQuerySchema } from "./validation";
import type { DashboardData } from "./types";

const PAGE_SIZE = 50;
const amount = "ROUND(t.minutes * t.hourly_rate / 60.0)";
const entryFrom = "FROM time_entries t JOIN projects p ON p.id=t.project_id JOIN clients c ON c.id=p.client_id";
const all = (sql: string, args: SQLInputValue[]) => db().prepare(sql).all(...args);
const one = (sql: string, args: SQLInputValue[]) => db().prepare(sql).get(...args)!;
const count = (sql: string, args: SQLInputValue[]) => Number(one(`SELECT COUNT(*) n ${sql}`,args).n);
function pagination(total: number, requested: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return pageModel.parse({ page: Math.min(requested, pages), pages, total, pageSize: PAGE_SIZE });
}
function search(columns: string[], query: string, args: SQLInputValue[]) {
  if (!query) return "";
  const pattern = `%${query.toLocaleLowerCase("pt-BR").replace(/[\\%_]/g, "\\$&")}%`;
  for (const _column of columns) args.push(pattern);
  return ` AND (${columns.map(column=>`search_text(${column}) LIKE ? ESCAPE '\\'`).join(" OR ")})`;
}
function clientRows(user: string, month: string, suffix: string, args: SQLInputValue[], limit: number, offset: number) {
  const range = monthRange(month);
  return clientModel.array().parse(all(`SELECT c.*,
    (SELECT COUNT(*) FROM projects p WHERE p.client_id=c.id AND p.user_id=c.user_id) project_count,
    COALESCE((SELECT SUM(t.minutes) FROM time_entries t JOIN projects p ON p.id=t.project_id
      WHERE p.client_id=c.id AND t.user_id=c.user_id AND t.date BETWEEN ? AND ?),0) month_minutes
    FROM clients c WHERE c.user_id=? ${suffix} ORDER BY c.name,c.id LIMIT ? OFFSET ?`,[range.start,range.end,user,...args,limit,offset]));
}
function projectRows(user: string, suffix: string, args: SQLInputValue[], limit: number, offset: number) {
  return projectModel.array().parse(all(`SELECT p.*,c.name client_name,c.color,c.hourly_rate,
    COALESCE((SELECT SUM(t.minutes) FROM time_entries t WHERE t.project_id=p.id AND t.user_id=p.user_id),0) minutes,
    COALESCE((SELECT SUM(${amount}) FROM time_entries t WHERE t.project_id=p.id AND t.user_id=p.user_id),0) amount,
    (SELECT COUNT(*) FROM time_entries t WHERE t.project_id=p.id AND t.user_id=p.user_id) entry_count
    FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.user_id=? ${suffix}
    ORDER BY p.created_at DESC,p.name,p.id LIMIT ? OFFSET ?`,[user,...args,limit,offset]));
}
function entryTotals(where: string, args: SQLInputValue[]) {
  return one(`SELECT COUNT(*) n,COALESCE(SUM(t.minutes),0) minutes,COALESCE(SUM(${amount}),0) amount ${entryFrom} WHERE ${where}`,args);
}

export function dashboardData(user: string, input: unknown = {}): DashboardData {
  const query = dashboardQuerySchema.parse(input);
  const { month, view, q, status } = query;
  const range = monthRange(month);
  const clientArgs: SQLInputValue[] = [];
  const clientWhere = search(["c.name","c.email"],view === "clients" ? q : "",clientArgs);
  const projectArgs: SQLInputValue[] = [];
  let projectWhere = search(["p.name","c.name"],view === "projects" ? q : "",projectArgs);
  if (view === "projects" && ["active","completed"].includes(status)) { projectWhere += " AND p.status=?"; projectArgs.push(status); }
  const entryArgs: SQLInputValue[] = view === "timer" ? [user,today()] : [user,range.start,range.end];
  let entryWhere = view === "timer" ? "t.user_id=? AND t.date=?" : "t.user_id=? AND t.date BETWEEN ? AND ?";
  if (view === "entries") {
    entryWhere += search(["t.description","p.name","c.name"],q,entryArgs);
    if (status === "billed") entryWhere += " AND t.invoice_id IS NOT NULL";
    if (status === "unbilled") entryWhere += " AND t.invoice_id IS NULL";
  }
  const invoiceArgs: SQLInputValue[] = [user,range.end,range.start];
  let invoiceWhere = "user_id=? AND start_date<=? AND end_date>=?";
  if (view === "invoices") {
    invoiceWhere += search(["client_name","number"],q,invoiceArgs);
    if (["draft","pending","paid"].includes(status)) { invoiceWhere += " AND status=?"; invoiceArgs.push(status); }
  }
  const entryStats = entryTotals(entryWhere,entryArgs);
  const invoiceStats = one(`SELECT COUNT(*) n,COALESCE(SUM(CASE WHEN status='pending' THEN total ELSE 0 END),0) pending,
    COALESCE(SUM(CASE WHEN status='paid' THEN total ELSE 0 END),0) paid FROM invoices WHERE ${invoiceWhere}`,invoiceArgs);
  const pages = {
    clients: pagination(count(`FROM clients c WHERE c.user_id=? ${clientWhere}`,[user,...clientArgs]),view === "clients" ? query.page : 1),
    projects: pagination(count(`FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.user_id=? ${projectWhere}`,[user,...projectArgs]),view === "projects" ? query.page : 1),
    entries: pagination(Number(entryStats.n),view === "entries" || view === "timer" ? query.page : 1),
    invoices: pagination(Number(invoiceStats.n),view === "invoices" ? query.page : 1),
  };
  const offset = (page: number) => (page-1)*PAGE_SIZE;
  const monthStats = one(`SELECT COUNT(*) n,COUNT(DISTINCT t.date) days,COALESCE(SUM(t.minutes),0) minutes,
    COALESCE(SUM(${amount}),0) amount,COALESCE(SUM(CASE WHEN invoice_id IS NULL THEN ${amount} ELSE 0 END),0) unbilled,
    COUNT(CASE WHEN invoice_id IS NULL THEN 1 END) unbilled_count FROM time_entries t WHERE user_id=? AND date BETWEEN ? AND ?`,[user,range.start,range.end]);
  const todayStats = entryTotals("t.user_id=? AND t.date=?",[user,today()]);
  const weekHours = Array<number>(Math.ceil(Number(range.end.slice(-2))/7)).fill(0);
  for (const row of all("SELECT CAST((CAST(substr(date,9,2) AS INTEGER)-1)/7 AS INTEGER) week,SUM(minutes) minutes FROM time_entries WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY week",[user,range.start,range.end])) weekHours[Number(row.week)] = Number(row.minutes)/60;
  return dashboardModel.parse({
    month,
    clients: clientRows(user,month,clientWhere,clientArgs,PAGE_SIZE,offset(pages.clients.page)),
    projects: projectRows(user,projectWhere,projectArgs,PAGE_SIZE,offset(pages.projects.page)),
    entries: entryModel.array().parse(all(`SELECT t.*,p.name project_name,c.name client_name,c.id client_id,c.color ${entryFrom}
      WHERE ${entryWhere} ORDER BY t.date DESC,t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`,[...entryArgs,PAGE_SIZE,offset(pages.entries.page)])),
    invoices: invoiceModel.array().parse(all(`SELECT * FROM invoices WHERE ${invoiceWhere} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,[...invoiceArgs,PAGE_SIZE,offset(pages.invoices.page)])),
    pagination: pages,
    summary: {
      monthMinutes: Number(monthStats.minutes),monthAmount: Number(monthStats.amount),monthEntryCount: Number(monthStats.n),workDays:Number(monthStats.days),
      unbilledAmount:Number(monthStats.unbilled),unbilledCount:Number(monthStats.unbilled_count),
      activeProjects:count("FROM projects WHERE user_id=? AND status='active'",[user]),clientCount:count("FROM clients WHERE user_id=?",[user]),
      pendingCount:count("FROM invoices WHERE user_id=? AND status='pending'",[user]),
      todayMinutes:Number(todayStats.minutes),todayAmount:Number(todayStats.amount),todayCount:Number(todayStats.n),weekHours,
      clientTotals:clientTotalModel.array().parse(all(`SELECT c.id,c.name,c.color,SUM(t.minutes) minutes ${entryFrom} WHERE t.user_id=? AND t.date BETWEEN ? AND ? GROUP BY c.id ORDER BY minutes DESC,c.id LIMIT 4`,[user,range.start,range.end])),
      featuredProjects:projectRows(user," AND p.status='active'",[],3,0),
      entryMinutes:Number(entryStats.minutes),entryAmount:Number(entryStats.amount),invoicePending:Number(invoiceStats.pending),invoicePaid:Number(invoiceStats.paid),
    },
  });
}

export function catalogData(user: string, input: unknown) {
  const query = catalogQuerySchema.parse(input);
  const args: SQLInputValue[] = [];
  let suffix = search(query.resource === "clients" ? ["c.name","c.email"] : ["p.name","c.name"],query.q,args);
  if(query.resource==='projects'&&query.status!=='all'){suffix+=' AND p.status=?';args.push(query.status);}
  const from = query.resource === "clients" ? "FROM clients c WHERE c.user_id=?" : "FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.user_id=?";
  const paginationInfo = pagination(count(`${from} ${suffix}`,[user,...args]),query.page);
  const offset = (paginationInfo.page-1)*PAGE_SIZE;
  const items = query.resource === "clients" ? clientRows(user,today().slice(0,7),suffix,args,PAGE_SIZE,offset) : projectRows(user,suffix,args,PAGE_SIZE,offset);
  return catalogModel.parse({resource:query.resource,items,pagination:paginationInfo});
}

export function invoicePreview(user: string, input: unknown) {
  const value = previewQuerySchema.parse(input);
  // Ownership is enforced by the query, including when no rows match.
  const totals = entryTotals("t.user_id=? AND p.user_id=? AND c.user_id=? AND c.id=? AND t.date BETWEEN ? AND ? AND t.invoice_id IS NULL",[user,user,user,value.client_id,value.start_date,value.end_date]);
  return previewModel.parse({count:Number(totals.n),minutes:Number(totals.minutes),amount:Number(totals.amount)});
}
