import { apiError, sameOrigin } from "@/lib/api";
import { registerAccount } from "@/lib/auth-security";
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    await registerAccount(request,await request.json());
    return Response.json({success:true},{status:201});
  } catch(e) { return apiError(e); }
}
