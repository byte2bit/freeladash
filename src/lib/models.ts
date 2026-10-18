import { z } from "zod";
import { invoiceStatuses } from "./invoice-status";

const text = z.string();
const number = z.number();
export const clientModel = z.object({ id: text, name: text, email: text, hourly_rate: number, color: text, project_count: number.default(0), month_minutes: number.default(0) });
export const projectModel = z.object({ id: text, client_id: text, name: text, status: z.enum(["active", "completed"]), client_name: text, color: text, hourly_rate: number, minutes: number.default(0), amount: number.default(0), entry_count: number.default(0) });
export const entryModel = z.object({ id: text, project_id: text, description: text, date: text, minutes: number, hourly_rate: number, invoice_id: text.nullable(), project_name: text, client_name: text, client_id: text, color: text });
export const invoiceModel = z.object({ id: text, client_id: text, number: text, start_date: text, end_date: text, total: number, minutes: number, status: z.enum(invoiceStatuses), client_name: text, client_email: text, created_at: text });
export const invoiceItemModel = z.object({ id: text, invoice_id: text, project_name: text, description: text, date: text, minutes: number, hourly_rate: number, amount: number });
export const timerModel = z.object({ id: text, project_id: text, description: text, started_at: number, project_name: text, client_name: text, color: text });
export const resourceModel = z.enum(["clients", "projects", "entries", "invoices"]);
export const viewModel = z.enum(["overview", "clients", "projects", "timer", "entries", "invoices"]);
export const pageModel = z.object({ page: number, pages: number, total: number, pageSize: number });
export const clientTotalModel = z.object({ id: text, name: text, color: text, minutes: number });
export const summaryModel = z.object({
  monthMinutes: number, monthAmount: number, monthEntryCount: number, workDays: number,
  unbilledAmount: number, unbilledCount: number, activeProjects: number, clientCount: number, pendingCount: number,
  todayMinutes: number, todayAmount: number, todayCount: number, weekHours: z.array(number), clientTotals: z.array(clientTotalModel),
  featuredProjects: z.array(projectModel), entryMinutes: number, entryAmount: number,
  invoicePending: number, invoicePaid: number,
});
export const dashboardModel = z.object({
  clients: z.array(clientModel), projects: z.array(projectModel), entries: z.array(entryModel), invoices: z.array(invoiceModel),
  month: text, summary: summaryModel,
  pagination: z.object({ clients: pageModel, projects: pageModel, entries: pageModel, invoices: pageModel }),
});
export const catalogModel = z.discriminatedUnion("resource", [
  z.object({ resource: z.literal("clients"), items: z.array(clientModel), pagination: pageModel }),
  z.object({ resource: z.literal("projects"), items: z.array(projectModel), pagination: pageModel }),
]);
export const previewModel = z.object({ count: number, minutes: number, amount: number });
