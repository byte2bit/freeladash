import { randomUUID } from "node:crypto";
import { hashSync } from "bcryptjs";
import { db, transaction } from "../src/lib/db";
import { today } from "../src/lib/format";
const email='demo@freeladash.com';
transaction(()=>{
  if (db().prepare('SELECT id FROM users WHERE email=?').get(email)) { console.log('Seed já existe. Os dados foram preservados.');return; }
  const user=randomUUID();
  db().prepare('INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)').run(user,'Lucas Oliveira',email,hashSync('Freela123!',12));
  const clients=[['Estúdio Aurora','contato@aurora.example',12000,'#8b5cf6'],['Orbit Digital','financeiro@orbit.example',15000,'#3b82f6'],['Café do Bairro','oi@cafe.example',10000,'#f59e0b'],['Verde & Co.','contato@verde.example',13000,'#10b981']] as const;
  const ids=clients.map(([name,email,rate,color])=>{const id=randomUUID();db().prepare('INSERT INTO clients(id,user_id,name,email,hourly_rate,color) VALUES(?,?,?,?,?,?)').run(id,user,name,email,rate,color);return id;});
  const projects=[['Redesign do website',0],['Plataforma de e-commerce',1],['Identidade visual',2],['Landing page institucional',3],['Design system',0]] as const;
  const pids=projects.map(([name,c])=>{const id=randomUUID();db().prepare('INSERT INTO projects(id,user_id,client_id,name,status) VALUES(?,?,?,?,?)').run(id,user,ids[c],name,'active');return id;});
  const current=today();const [year,month,day]=current.split('-').map(Number);
  const descriptions=['Ajustes de layout e responsividade','Desenvolvimento da página inicial','Revisão de componentes e protótipo','Alinhamento e planejamento de entregas','Implementação e testes de navegação','Exploração visual e refinamento'];
  for(let i=0;i<24;i++) {
    const p=i%projects.length,c=projects[p][1];const d=new Date(Date.UTC(year,month-1,Math.max(1,day-(i%Math.max(day,1))))).toISOString().slice(0,10);
    db().prepare('INSERT INTO time_entries(id,user_id,project_id,description,date,minutes,hourly_rate) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),user,pids[p],descriptions[i%descriptions.length],d,[120,180,90,240,150,210][i%6],clients[c][2]);
  }
  // A previous-month invoice with immutable items and linked entries.
  const previous=new Date(Date.UTC(year,month-2,15)).toISOString().slice(0,7);
  const last=new Date(Date.UTC(year,month-1,0)).getUTCDate();const invoice=randomUUID();
  db().prepare('INSERT INTO invoices(id,user_id,client_id,number,start_date,end_date,total,minutes,status,client_name,client_email) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(invoice,user,ids[1],'FD-0001',`${previous}-01`,`${previous}-${last}`,180000,720,'paid',clients[1][0],clients[1][1]);
  for(let i=0;i<3;i++) {
    const date=`${previous}-${String(10+i).padStart(2,'0')}`;
    db().prepare('INSERT INTO time_entries(id,user_id,project_id,description,date,minutes,hourly_rate,invoice_id) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),user,pids[1],descriptions[i],date,240,15000,invoice);
    db().prepare('INSERT INTO invoice_items(id,invoice_id,project_name,description,date,minutes,hourly_rate,amount) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),invoice,projects[1][0],descriptions[i],date,240,15000,60000);
  }
  console.log('Seed criado: demo@freeladash.com / Freela123!');
});
