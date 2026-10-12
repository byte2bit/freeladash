import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { dashboardData } from "@/lib/service";
import { Dashboard } from "@/components/dashboard";
export const dynamic="force-dynamic";
export default async function Home() {
  const session=await auth();
  if (!session?.user?.id) redirect('/login');
  return <Dashboard initialData={dashboardData(session.user.id)} user={{name:session.user.name || 'Freelancer',email:session.user.email || ''}} />;
}
