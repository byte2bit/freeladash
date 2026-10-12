import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"FreelaDash · Seu trabalho, em dia",description:"Clientes, projetos, horas e cobranças em um só lugar."};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR"><body>{children}</body></html>; }
