import type { z } from "zod";
import type { clientModel, projectModel, entryModel, invoiceModel, dashboardModel, timerModel, clientTotalModel, resourceModel, viewModel } from "./models";

export type Client = z.infer<typeof clientModel>;
export type Project = z.infer<typeof projectModel>;
export type Entry = z.infer<typeof entryModel>;
export type Invoice = z.infer<typeof invoiceModel>;
export type DashboardData = z.infer<typeof dashboardModel>;
export type Timer = z.infer<typeof timerModel>;
export type ClientTotal = z.infer<typeof clientTotalModel>;
export type Resource = z.infer<typeof resourceModel>;
export type View = z.infer<typeof viewModel>;
