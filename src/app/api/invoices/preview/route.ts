import { apiError, apiUser } from "@/lib/api";
import { invoicePreview } from "@/lib/dashboard-data";
export async function GET(request: Request) {
  try { return Response.json(invoicePreview(await apiUser(request),Object.fromEntries(new URL(request.url).searchParams)),{headers:{"Cache-Control":"no-store"}}); }
  catch (error) { return apiError(error); }
}
