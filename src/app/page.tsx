import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { dashboardData } from "@/lib/service";
import { Dashboard } from "@/components/dashboard";
import { activeTimer } from "@/lib/timer";
import { dashboardQuerySchema } from "@/lib/validation";
export const dynamic="force-dynamic";
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const session=await auth();
  if (!session?.user?.id) redirect('/login');
  const parsed=dashboardQuerySchema.safeParse(await searchParams);
  const query=parsed.success?parsed.data:dashboardQuerySchema.parse({});
  return <Dashboard initialData={dashboardData(session.user.id,query)} initialQuery={query} initialTimer={activeTimer(session.user.id)} user={{name:session.user.name || 'Freelancer',email:session.user.email || ''}} />;
}
