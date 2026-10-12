"use client";
import { ArrowLeft, Download, Printer } from 'lucide-react';
import Link from 'next/link';
export function InvoiceActions({id}:{id:string}) {return <nav className="invoice-actions"><Link className="button" href="/"><ArrowLeft size={16}/>Voltar ao painel</Link><div><a className="button" href={`/api/invoices/${id}/export`}><Download size={16}/>Exportar CSV</a><button className="button primary" onClick={()=>window.print()}><Printer size={16}/>Imprimir / Salvar PDF</button></div></nav>;}
