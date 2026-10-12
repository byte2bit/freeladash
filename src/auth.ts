import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compareSync } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { allowAuth, db } from "@/lib/db";
import { loginSchema } from "@/lib/validation";

function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") return undefined;
  mkdirSync(resolve("data"), { recursive:true });
  const path=resolve("data/.auth-secret");
  if (!existsSync(path)) { try { writeFileSync(path,randomBytes(32).toString("hex"),{flag:'wx'}); } catch (e) { if (!existsSync(path)) throw e; } }
  return readFileSync(path,"utf8").trim();
}
export const googleEnabled=Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret:authSecret(),
  pages:{ signIn:"/login", error:"/login" },
  session:{ strategy:"jwt", maxAge:7*24*60*60 },
  providers:[
    Credentials({ credentials:{email:{},password:{}}, authorize(credentials) {
      const parsed=loginSchema.safeParse(credentials);
      if (!parsed.success) return null;
      if (!allowAuth(`login:${parsed.data.email}`)) return null;
      const user=db().prepare("SELECT * FROM users WHERE email=?").get(parsed.data.email);
      // Keep a password hash comparison even for an unknown email.
      const hash=String(user?.password_hash || "$2b$12$LQv3c1yqBWVHxkd0LHAkCOY7ev.2NPvqWOlDQJgz5CknOJLKIHBKa");
      const valid=compareSync(parsed.data.password,hash);
      if (!user?.password_hash || !valid) return null;
      db().prepare("DELETE FROM auth_attempts WHERE key=?").run(`login:${parsed.data.email}`);
      return { id:String(user.id), name:String(user.name), email:String(user.email) };
    }}),
    ...(googleEnabled ? [Google({clientId:process.env.AUTH_GOOGLE_ID!,clientSecret:process.env.AUTH_GOOGLE_SECRET!})] : []),
  ],
  callbacks:{
    async signIn({user,account,profile}) {
      if (account?.provider !== 'google') return true;
      if (!profile?.email_verified || !user.email || !profile.sub) return false;
      const email=user.email.toLowerCase();
      const existing=db().prepare("SELECT * FROM users WHERE email=?").get(email);
      if (existing?.google_sub && existing.google_sub!==profile.sub) return false;
      const id=existing ? String(existing.id) : randomUUID();
      if (existing) db().prepare("UPDATE users SET google_sub=? WHERE id=?").run(profile.sub,id);
      else db().prepare("INSERT INTO users(id,name,email,google_sub) VALUES(?,?,?,?)").run(id,user.name || 'Freelancer',email,profile.sub);
      user.id=id; return true;
    },
    async jwt({token,user}) { if (user?.id) token.sub=user.id; return token; },
    async session({session,token}) { if (session.user && token.sub) session.user.id=token.sub; return session; },
  },
});
