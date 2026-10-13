import {openLocalDB} from './server/local-db.js';
import {createLocalAuth} from './server/local-auth.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import app from './server/app.js';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const port=Number(process.env.PORT||4173);
const DB=await openLocalDB(path.join(path.dirname(fileURLToPath(import.meta.url)),'.local-data','bookings.sqlite'));
const env={...process.env,DB};
const auth=createLocalAuth(DB);
const server=http.createServer(async(req,res)=>{
  try{
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);res.end('Unsupported host');return;}
    const origin='http://'+req.headers.host;const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/')){
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'PAYLOAD_TOO_LARGE',message:'The request is too large.'}}));return;}chunks.push(chunk);}
      const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
      headers.set('CF-Connecting-IP',req.socket.remoteAddress||'local');
      for(const key of [...headers.keys()])if(key.startsWith('oai-'))headers.delete(key);
      const request=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      const authResponse=await auth.route(request,req.socket.remoteAddress||'local');
      const response=authResponse||await app.fetch(request,env,await auth.identity(request));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const pathname=decodeURIComponent(url.pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log('Travel search: http://127.0.0.1:'+port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
