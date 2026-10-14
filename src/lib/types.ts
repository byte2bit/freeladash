export type Client = { id: string; name: string; email: string; hourly_rate: number; color: string };
export type Project = { id: string; client_id: string; name: string; status: "active" | "completed"; client_name: string; color: string; hourly_rate: number };
export type Entry = { id: string; project_id: string; description: string; date: string; minutes: number; hourly_rate: number; invoice_id: string | null; project_name: string; client_name: string; client_id: string; color: string };
export type Invoice = { id: string; client_id: string; number: string; start_date: string; end_date: string; total: number; minutes: number; status: "pending" | "paid"; client_name: string; client_email: string; created_at: string };
export type DashboardData = { clients: Client[]; projects: Project[]; entries: Entry[]; invoices: Invoice[] };
export type Timer = { id: string; project_id: string; description: string; started_at: number; project_name: string; client_name: string; color: string };
