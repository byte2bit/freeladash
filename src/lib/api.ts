import { auth } from "@/auth";
import { HttpError } from "./service";
import { ZodError } from "zod";
export async function apiUser(request: Request, write=false) {
  if (write) sameOrigin(request);
  const session=await auth();
  if (!session?.user?.id) throw new HttpError(401,"Faça login para continuar.");
  return session.user.id;
}
export function sameOrigin(request: Request) {
  const origin=request.headers.get('origin');
  const expected=new URL(process.env.AUTH_URL || request.url).origin;
  if (!origin || origin!==expected) throw new HttpError(403,"Origem da requisição inválida.");
}
export function apiError(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error:error.issues.map(i=>i.message).join(' ') },{status:400});
  if (error instanceof HttpError) return Response.json({error:error.message},{status:error.status});
  if (error instanceof SyntaxError) return Response.json({error:"JSON inválido."},{status:400});
  console.error(error); return Response.json({error:"Não foi possível concluir a operação."},{status:500});
}
