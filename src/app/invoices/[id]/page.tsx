import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { HttpError, invoiceDetail } from "@/lib/service";
import { money, hours } from "@/lib/format";
import { InvoiceActions } from "@/components/invoice-actions";
export const dynamic='force-dynamic';
export default async function InvoicePage({params}:{params:Promise<{id:string}>}) {
  const session=await auth();if(!session?.user?.id) redirect('/login');
  const {id}=await params;
  let detail;try {detail=invoiceDetail(session.user.id,id);}catch(e){if(e instanceof HttpError&&e.status===404) notFound();throw e;}
  const {invoice,items}=detail;
  const fullDate=(v:string)=>new Date(`${v}T12:00:00`).toLocaleDateString('pt-BR');
  return <main className="invoice-document"><InvoiceActions id={id}/><div className="invoice-paper"><header><div><span className="eyebrow">FREELADASH</span><h1>Relatório de serviços</h1><p>Cobrança {invoice.number}</p></div><span className={`badge ${invoice.status==='paid'?'green':'amber'}`}>{invoice.status==='paid'?'Pago':'Pendente'}</span></header><div className="invoice-parties"><div><small>PRESTADOR</small><h3>{session.user.name}</h3><p>{session.user.email}</p></div><div><small>CLIENTE</small><h3>{invoice.client_name}</h3><p>{invoice.client_email}</p></div></div><p className="invoice-period">Período: {fullDate(invoice.start_date)} a {fullDate(invoice.end_date)}</p><div className="table-wrap"><table><thead><tr><th>Data / Projeto</th><th>Descrição</th><th>Horas</th><th>Valor/hora</th><th>Subtotal</th></tr></thead><tbody>{items.map(item=><tr key={String(item.id)}><td>{fullDate(String(item.date))}<small>{String(item.project_name)}</small></td><td>{String(item.description)}</td><td>{hours(Number(item.minutes))}</td><td>{money(Number(item.hourly_rate))}</td><td>{money(Number(item.amount))}</td></tr>)}</tbody></table></div><div className="invoice-total"><span>{hours(invoice.minutes)} de trabalho</span><div><small>TOTAL DA COBRANÇA</small><strong>{money(invoice.total)}</strong></div></div><footer>Relatório de serviços para cobrança. Este documento não é uma nota fiscal.</footer></div></main>;
}
