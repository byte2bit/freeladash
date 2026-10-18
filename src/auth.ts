import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { authSecret } from "@/lib/auth-secret";
import { authorizeCredentials, googleUser, validAuthSession } from "@/lib/auth-security";
export const googleEnabled=Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret:authSecret(),
  pages:{ signIn:"/login", error:"/login" },
  session:{ strategy:"jwt", maxAge:7*24*60*60 },
  providers:[
    Credentials({ credentials:{email:{},password:{}}, authorize: authorizeCredentials }),
    ...(googleEnabled ? [Google({clientId:process.env.AUTH_GOOGLE_ID!,clientSecret:process.env.AUTH_GOOGLE_SECRET!})] : []),
  ],
  callbacks:{
    async signIn({user,account,profile}) {
      if (account?.provider !== 'google') return true;
      const id=googleUser({email:user.email,name:user.name,sub:profile?.sub,verified:profile?.email_verified});
      if (!id) return false;
      user.id=id; return true;
    },
    async jwt({token,user,account}) {
      if (user?.id) { token.sub=user.id; token.authProvider=account?.provider; }
      // Legacy tokens without a provider must reauthenticate once after this fix.
      return validAuthSession(token.sub,token.authProvider) ? token : null;
    },
    async session({session,token}) { if (session.user && token.sub) session.user.id=token.sub; return session; },
  },
});
