import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd(),port=4173;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
http.createServer((request,response)=>{
  const raw=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const relative=raw==='/'?'index.html':raw.replace(/^\/+/,''),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end('Forbidden');return;}
  fs.readFile(file,(error,data)=>{if(error){response.writeHead(404);response.end('Not found');return;}response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});response.end(data);});
}).listen(port,'127.0.0.1',()=>process.stdout.write(`Accaza test server listening on ${port}\n`));
