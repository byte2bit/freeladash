"use client";
import { ArrowLeft, Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Invoice } from '@/lib/types';
import { InvoiceStatusSelect } from './invoice-status-select';
export function InvoiceActions({invoice}:{invoice:Invoice}) {
  const router=useRouter();
  return <nav className="invoice-actions"><Link className="button" href="/?view=invoices"><ArrowLeft size={16}/>Voltar às cobranças</Link><div><InvoiceStatusSelect id={invoice.id} number={invoice.number} status={invoice.status} onUpdated={()=>router.refresh()}/><a className="button" href={`/api/invoices/${invoice.id}/export`}><Download size={16}/>Exportar CSV</a><button className="button primary" onClick={()=>window.print()}><Printer size={16}/>Imprimir / Salvar PDF</button></div></nav>;
}
