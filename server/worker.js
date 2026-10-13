import app from './app.js';
import {hostedIdentity} from './accounts.js';
import assets from '../.sites-runtime/text-assets.json';
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/'))return app.fetch(request,env,hostedIdentity(request));
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET, HEAD'}});
    const name=path==='/'?'/index.html':path;
    const asset=assets[name];
    if(asset)return new Response(request.method==='HEAD'?null:asset.body,{headers:{...headers,'Content-Type':asset.type,'Cache-Control':'no-cache'}});
    if(path==='/konkan-railway.jpg'){
      if(env.ASSETS)return env.ASSETS.fetch(request);
      return Response.redirect('https://upload.wikimedia.org/wikipedia/commons/c/cf/Konkan_Railway.jpg',302);
    }
    return new Response('Not found',{status:404,headers});
  }
};
