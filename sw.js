const V='md-v3',CORE=['./','index.html','styles.css','voice-chat.js','manifest.webmanifest','images/icon-192.png','images/icon-512.png'],CDN='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all([c.addAll(CORE),c.add(new Request(CDN,{mode:'no-cors'})).catch(()=>{})])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!='GET')return;
if(r.url==CDN){e.respondWith(caches.match(r).then(m=>m||fetch(r)));return}
if(u.origin!=location.origin)return;
e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(V).then(c=>c.put(r,cp));return res}).catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))))});
