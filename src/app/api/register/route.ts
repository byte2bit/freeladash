import { randomUUID } from "node:crypto";
import { hashSync } from "bcryptjs";
import { allowAuth, db } from "@/lib/db";
import { apiError, sameOrigin } from "@/lib/api";
import { HttpError } from "@/lib/service";
import { registrationSchema } from "@/lib/validation";
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    if (!allowAuth('register:global')) throw new HttpError(429,"Muitas tentativas. Aguarde 15 minutos.");
    const v=registrationSchema.parse(await request.json());
    if (db().prepare("SELECT id FROM users WHERE email=?").get(v.email)) throw new HttpError(409,"Não foi possível criar a conta com este email.");
    db().prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)").run(randomUUID(),v.name,v.email,hashSync(v.password,12));
    return Response.json({success:true},{status:201});
  } catch(e) { return apiError(e); }
}
