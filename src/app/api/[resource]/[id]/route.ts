import { apiError, apiUser } from "@/lib/api";
import { mutate } from "@/lib/service";
type Context={params:Promise<{resource:string;id:string}>};
async function write(request:Request,context:Context,method:string) {
  try { const user=await apiUser(request,true); const {resource,id}=await context.params; return Response.json(mutate(user,resource,method,id,method==='DELETE'?null:await request.json())); } catch(e) {return apiError(e);}
}
export const PATCH=(request:Request,context:Context)=>write(request,context,'PATCH');
export const DELETE=(request:Request,context:Context)=>write(request,context,'DELETE');
