export const invoiceStatuses = ["draft", "pending", "paid"] as const;
export type InvoiceStatus = typeof invoiceStatuses[number];
export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  draft: "Rascunho",
  pending: "Pendente",
  paid: "Paga",
};
export const invoiceStatusColors: Record<InvoiceStatus, string> = {
  draft: "gray",
  pending: "amber",
  paid: "green",
};
