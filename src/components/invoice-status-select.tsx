"use client";

import { useEffect, useId, useState } from "react";
import { invoiceStatuses, invoiceStatusLabels, type InvoiceStatus } from "@/lib/invoice-status";

export function InvoiceStatusSelect({ id, number, status, onUpdated }: {
  id: string;
  number: string;
  status: InvoiceStatus;
  onUpdated: () => void | Promise<void>;
}) {
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const feedbackId = useId();
  useEffect(() => { setValue(status); }, [status]);

  async function update(next: InvoiceStatus) {
    if (busy || next === value) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível alterar o status.");
      setValue(next);
      await onUpdated();
      setMessage("Status atualizado.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível alterar o status.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="invoice-status-control">
    <select aria-label={`Status da cobrança ${number}`} aria-describedby={feedbackId} value={value} disabled={busy} onChange={event => void update(event.target.value as InvoiceStatus)}>
      {invoiceStatuses.map(status => <option key={status} value={status}>{invoiceStatusLabels[status]}</option>)}
    </select>
    <span id={feedbackId} role={error ? "alert" : "status"} className={error ? "invoice-status-error" : "invoice-status-feedback"}>{error || (busy ? "Salvando…" : message)}</span>
  </div>;
}
