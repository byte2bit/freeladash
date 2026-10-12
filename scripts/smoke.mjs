// Run against an already-running local server with the seed account.
import assert from 'node:assert/strict';
const base=process.env.SMOKE_URL || 'http://localhost:3000';
const cookies=new Map();
async function call(path,options={},authenticated=true){
  const response=await fetch(`${base}${path}`,{...options,redirect:'manual',headers:{Origin:base,...(authenticated?{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{}),...options.headers}});
  if(authenticated)for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0];const index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));}
  return response;
}
const write=(path,method,body)=>call(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
assert.equal((await call('/api/data',{},false)).status,401);
assert.equal((await call('/api/invoices/unknown/export',{},false)).status,401);
const home=await call('/',{},false);assert.equal(home.status,307);assert.ok(home.headers.get('location')?.endsWith('/login'));
const csrf=await (await call('/api/auth/csrf')).json();
const login=await call('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({csrfToken:csrf.csrfToken,email:'demo@freeladash.com',password:'Freela123!',callbackUrl:base})});
assert.equal(login.status,200);const logged=await login.json();assert.ok(!logged.url.includes('error'), 'Login failed');
const response=await call('/api/data');assert.equal(response.status,200);const initial=await response.json();assert.ok(initial.clients.length>=4);
const dashboard=await call('/');assert.equal(dashboard.status,200);assert.ok((await dashboard.text()).includes('Visão geral'));
assert.equal((await write('/api/clients','POST',{name:'X',email:'invalid',hourly_rate:-1})).status,400);
assert.equal((await call('/api/clients',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({name:'Cliente',email:'test@example.com',hourly_rate:10000})})).status,403);
let client,project,entry;
try {
  const clientResponse=await write('/api/clients','POST',{name:'Cliente smoke descartável',email:'smoke@example.com',hourly_rate:12000});assert.equal(clientResponse.status,201);client=(await clientResponse.json()).id;
  const projectResponse=await write('/api/projects','POST',{name:'Projeto smoke',client_id:client});assert.equal(projectResponse.status,201);project=(await projectResponse.json()).id;
  const entryResponse=await write('/api/entries','POST',{project_id:project,description:'Registro para verificar a API',date:'2026-10-12',minutes:75});assert.equal(entryResponse.status,201);entry=(await entryResponse.json()).id;
  assert.equal((await write(`/api/entries/${entry}`,'PATCH',{project_id:project,description:'Registro atualizado',date:'2026-10-12',minutes:90})).status,200);
  assert.equal((await write(`/api/clients/${client}`,'DELETE')).status,409);
  const current=await (await call('/api/data')).json();assert.equal(current.entries.find(e=>e.id===entry).minutes,90);
  const invoice=initial.invoices[0];assert.ok(invoice);
  assert.equal((await call(`/invoices/${invoice.id}`)).status,200);
  const csv=await call(`/api/invoices/${invoice.id}/export`);assert.equal(csv.status,200);assert.ok(csv.headers.get('content-type').startsWith('text/csv'));const content=await csv.text();assert.ok(content.includes(invoice.number));assert.ok(content.includes(invoice.start_date.split('-').reverse().join('/')));
  assert.equal((await call('/api/invoices/00000000-0000-4000-8000-000000000000/export')).status,404);
}finally{
  // Delete only the disposable records created by this script, in dependency order.
  if(entry)assert.equal((await write(`/api/entries/${entry}`,'DELETE')).status,200);
  if(project)assert.equal((await write(`/api/projects/${project}`,'DELETE')).status,200);
  if(client)assert.equal((await write(`/api/clients/${client}`,'DELETE')).status,200);
}
const final=await (await call('/api/data')).json();
for(const resource of ['clients','projects','entries','invoices'])assert.equal(final[resource].length,initial[resource].length);
console.log('Smoke passou: login, rotas protegidas, CSRF/origem, validação, CRUD, relatório e exportação CSV. Dados descartáveis removidos.');
