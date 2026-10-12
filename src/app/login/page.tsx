import { auth, googleEnabled } from "@/auth";
import { redirect } from "next/navigation";
import { Login } from "@/components/login";
export default async function LoginPage() { if ((await auth())?.user) redirect('/'); return <Login googleEnabled={googleEnabled}/>; }
