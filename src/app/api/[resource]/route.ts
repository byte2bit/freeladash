import { apiError, apiUser } from "@/lib/api";
import { mutate } from "@/lib/service";
export async function POST(request:Request,context:{params:Promise<{resource:string}>}) {
  try { const user=await apiUser(request,true); const {resource}=await context.params; return Response.json(mutate(user,resource,'POST',undefined,await request.json()),{status:201}); } catch(e) { return apiError(e); }
}
