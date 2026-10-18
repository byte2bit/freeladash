import { apiError, apiUser } from "@/lib/api";
import { dashboardData } from "@/lib/service";
export async function GET(request:Request) { try { return Response.json(dashboardData(await apiUser(request),Object.fromEntries(new URL(request.url).searchParams)),{headers:{'Cache-Control':'no-store'}}); } catch(e) { return apiError(e); } }
