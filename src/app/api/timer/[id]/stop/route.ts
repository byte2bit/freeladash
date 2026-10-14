import { apiError, apiUser } from "@/lib/api";
import { stopTimer } from "@/lib/timer";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await apiUser(request, true);
    const { id } = await context.params;
    return Response.json(stopTimer(user, id));
  } catch (error) { return apiError(error); }
}
