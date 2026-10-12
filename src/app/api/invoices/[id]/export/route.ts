import { apiError, apiUser } from '@/lib/api';
import { invoiceDetail } from '@/lib/service';
import { money, hours } from '@/lib/format';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const user=await apiUser(request);const {id}=await params;const {invoice,items}=invoiceDetail(user,id);
    const cell=(v:unknown)=>{let s=String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
    const date=(value:string)=>value.split('-').reverse().join('/');
    const rows:unknown[][]=[['Cobrança',invoice.number],['Cliente',invoice.client_name],['Email',invoice.client_email],['Período',date(invoice.start_date),date(invoice.end_date)],[],['Data','Projeto','Descrição','Horas','Valor/hora','Subtotal'],...items.map(i=>[date(String(i.date)),i.project_name,i.description,hours(Number(i.minutes)),money(Number(i.hourly_rate)),money(Number(i.amount))]),[],['Total',hours(invoice.minutes),money(invoice.total)]];
    return new Response('\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${invoice.number}.csv"`,'Cache-Control':'no-store'}});
  }catch(e){return apiError(e);}
}
