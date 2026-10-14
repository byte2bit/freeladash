import { apiError, apiUser } from "@/lib/api";
import { activeTimer, startTimer } from "@/lib/timer";

export async function GET(request: Request) {
  try { return Response.json({ timer: activeTimer(await apiUser(request)), now: Date.now() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await apiUser(request, true);
    return Response.json({ timer: startTimer(user, await request.json()), now: Date.now() }, { status: 201 });
  } catch (error) { return apiError(error); }
}
