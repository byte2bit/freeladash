// Integration checks always use their own server, secret and disposable database.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

const temporary=await mkdtemp(join(tmpdir(),'freeladash-http-'));
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{
  cwd:resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,NODE_ENV:'production',DATABASE_PATH:join(temporary,'test.sqlite'),AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_URL:base,AUTH_TRUST_HOST:'true',AUTH_GOOGLE_ID:'',AUTH_GOOGLE_SECRET:'',AUTH_RATE_LIMIT_IP_HEADER:''},
});
let output='';
for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-6000);});
server.on('error',error=>{output+=error.message;});
function browser() {
  const cookies=new Map();
  async function call(path,options={}) {
    const response=await fetch(base+path,{...options,redirect:'manual',headers:{Origin:base,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...options.headers},signal:AbortSignal.timeout(15000)});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));}
    return response;
  }
  const write=(path,body,method='POST',headers={})=>call(path,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  async function csrf(){const response=await call('/api/auth/csrf');assert.equal(response.status,200);return (await response.json()).csrfToken;}
  async function login(email,password){const token=await csrf();const response=await call('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({csrfToken:token,email,password,callbackUrl:base})});assert.equal(response.status,200);return response.json();}
  return {call,write,csrf,login};
}
try {
  let ready=false;
  for(let i=0;i<120;i++){
    if(server.exitCode!==null)throw new Error(`Servidor encerrou: ${output}`);
    try {const response=await fetch(base+'/api/auth/csrf',{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}
    await sleep(250);
  }
  assert.ok(ready,`Servidor não iniciou: ${output}`);
  const a=browser(),b=browser();
  for(const path of ['/api/data','/api/catalog?resource=clients','/api/invoices/preview?client_id=invalid','/api/timer'])assert.equal((await a.call(path)).status,401,path);
  assert.equal((await a.call('/')).status,307);
  const password=`Test-only-${randomUUID()}`;
  const token=await a.csrf();
  assert.equal((await a.write('/api/register',{name:'Teste',email:'http@example.com',password})).status,403);
  for(let i=0;i<10;i++)assert.equal((await a.write('/api/register',{},'POST',{'X-CSRF-Token':token})).status,400);
  assert.equal((await a.write('/api/register',{name:'Teste HTTP',email:'http@example.com',password},'POST',{'X-CSRF-Token':token})).status,201);
  assert.ok(!(await a.login('http@example.com',password)).url.includes('error'));
  const home=await a.call('/');assert.equal(home.status,200);assert.ok((await home.text()).includes('Visão geral'));
  const clientResponse=await a.write('/api/clients',{name:'Cliente HTTP',email:'client@example.com',hourly_rate:10000});assert.equal(clientResponse.status,201);const client=await clientResponse.json();
  const projectResponse=await a.write('/api/projects',{name:'Projeto HTTP',client_id:client.id});assert.equal(projectResponse.status,201);const project=await projectResponse.json();
  for(let i=0;i<52;i++)assert.equal((await a.write('/api/entries',{project_id:project.id,description:`Registro HTTP ${i}`,date:'2026-10-12',minutes:60})).status,201);
  const pageResponse=await a.call('/api/data?view=entries&month=2026-10');assert.equal(pageResponse.headers.get('cache-control'),'no-store');const page=await pageResponse.json();
  assert.equal(page.entries.length,50);assert.equal(page.pagination.entries.total,52);assert.equal(page.summary.monthMinutes,3120);
  const last=await (await a.call('/api/data?view=entries&month=2026-10&page=2')).json();assert.equal(last.entries.length,2);
  assert.equal(new Set([...page.entries,...last.entries].map(entry=>entry.id)).size,52);
  assert.equal((await a.call('/api/data?month=2026-99')).status,400);
  const preview=await (await a.call(`/api/invoices/preview?client_id=${client.id}&start_date=2026-10-01&end_date=2026-10-31`)).json();assert.equal(preview.count,52);assert.equal(preview.amount,520000);
  assert.equal((await (await a.call('/api/catalog?resource=projects&q=HTTP')).json()).items.length,1);
  const invoiceResponse=await a.write('/api/invoices',{client_id:client.id,start_date:'2026-10-01',end_date:'2026-10-31',status:'draft'});assert.equal(invoiceResponse.status,201);const invoice=await invoiceResponse.json();
  assert.equal((await a.call(`/invoices/${invoice.id}`)).status,200);
  assert.equal((await a.call(`/api/invoices/${invoice.id}/export`)).status,200);
  assert.equal((await a.write(`/api/invoices/${invoice.id}`,{status:'paid'},'PATCH')).status,200);
  assert.equal((await a.write(`/api/entries/${page.entries[0].id}`,{},'DELETE')).status,409);
  const otherToken=await b.csrf();
  assert.equal((await b.write('/api/register',{name:'Outra conta',email:'other-http@example.com',password},'POST',{'X-CSRF-Token':otherToken})).status,201);
  assert.ok(!(await b.login('other-http@example.com',password)).url.includes('error'));
  assert.equal((await b.call(`/api/invoices/${invoice.id}/export`)).status,404);
  assert.equal((await (await b.call('/api/data?month=2026-10')).json()).entries.length,0);
  assert.equal((await a.write('/api/clients',{name:'Origem inválida',email:'invalid@example.com',hourly_rate:1},'POST',{Origin:'https://invalid.example'})).status,403);
  console.log('HTTP passou: cadastro/CSRF, cookies/sessão, rotas privadas, paginação, totais, prévia, cobrança/CSV e isolamento. Banco descartável.');
} catch(error) {
  console.error(output);throw error;
} finally {
  const stopped=server.exitCode!==null?Promise.resolve():once(server,'exit');
  server.kill();await stopped;
  await rm(temporary,{recursive:true,force:true,maxRetries:3});
}
