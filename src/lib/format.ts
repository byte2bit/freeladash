export const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
export const hours = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}min` : ""}`;
export const dateLabel = (date: string) => new Date(`${date.slice(0,10)}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const entryAmount = (minutes: number, rate: number) => Math.round(minutes * rate / 60);
export function monthRange(month: string) { const [y,m] = month.split("-").map(Number); return { start: `${month}-01`, end: `${month}-${new Date(y,m,0).getDate()}` }; }
