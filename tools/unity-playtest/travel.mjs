import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
assert.equal(manifest.buildFlavor, 'LOCAL_CANDIDATE_REVIEW');
assert.equal(manifest.productionPromotion, false);
const sha = manifest.sourceSha;
const serverSha = process.env.GQ_REVIEW_SERVER_SHA || sha;
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), serverSha);
assert.equal(execFileSync('git', ['status', '--porcelain'], {encoding:'utf8'}).trim(), '');
for (const file of manifest.files) {
  const bytes = readFileSync(join('unity/GalaQuest/Builds/GalaQuestWebGL/Build', file.name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name);
}
const suffix = process.argv[3] ?? '';
assert.match(suffix, /^[a-z0-9-]*$/);
const output = resolve(`.local/m3/browser-${sha.slice(0,7)}${suffix}`);
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gq-m3-chrome-'));
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 0; this.pending = new Map(); this.events = [];
    this.ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) { this.events.push(message); return; }
      const task = this.pending.get(message.id); if (!task) return;
      this.pending.delete(message.id); clearTimeout(task.timer);
      message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
    });
  }
  ready() { return new Promise((resolve,reject) => { this.ws.addEventListener('open',resolve,{once:true}); this.ws.addEventListener('error',reject,{once:true}); }); }
  send(method,params={}) {
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timeout`));},30000);
      this.pending.set(id,{resolve,reject,timer}); this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  async eval(expression) {
    const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  }
}
let browser,chrome,server,port;
const pages=[];
const checks={};
const bootstrap = (id,name) => `
  localStorage.setItem('gq-profiles',JSON.stringify({activeProfileId:'${id}',profiles:[{id:'${id}',displayName:'${name}'}]}));
  window.__fightAudio={contexts:[],starts:0};
  const Native=window.AudioContext;
  if(Native)window.AudioContext=new Proxy(Native,{construct(target,args){
    const context=new target(...args);window.__fightAudio.contexts.push(context);
    const create=context.createBufferSource.bind(context);
    context.createBufferSource=function(){const node=create();const start=node.start.bind(node);node.start=function(...args){window.__fightAudio.starts++;return start(...args)};return node};
    return context;
  }});
`;
const frame = p=>p.eval('window.__gqUnityCp2Diagnostics?.latestServerFrame ?? null');
const sample = p=>p.eval(`(()=>{const d=window.__gqUnityCp2Diagnostics;if(!d?.latestReconciliation)return null;const f=d.latestServerFrame;return {frame:f,reconciliation:d.latestReconciliation,input:d.latestInput,audio:{starts:window.__fightAudio.starts,states:window.__fightAudio.contexts.map(c=>c.state)}}})()`);
const waitFor = async (action,predicate,label,timeout=30000,interval=50)=>{
  const until=Date.now()+timeout; let value;
  while(Date.now()<until){value=await action();if(predicate(value))return value;await delay(interval);}
  throw new Error(`${label}: ${JSON.stringify(value).slice(0,1200)}`);
};
const key = (p,type,k)=>p.send('Input.dispatchKeyEvent',{type,key:k,code:k===' '?'Space':`Key${k.toUpperCase()}`,windowsVirtualKeyCode:k===' '?32:k.toUpperCase().charCodeAt(0)});
const capture = async (p,name)=>{const shot=await p.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,`${name}.png`),Buffer.from(shot.data,'base64'));};
const touch = (p,type,points)=>p.send('Input.dispatchTouchEvent',{type,touchPoints:points});
const point = (p,id,x,y)=>({id,x:p.rect.x+x*p.rect.width,y:p.rect.y+y*p.rect.height,radiusX:8,radiusY:8,force:1});
const tap = async(p,x,y)=>{await touch(p,'touchStart',[point(p,3,x,y)]);await delay(70);await touch(p,'touchEnd',[]);};
const moveAxis = async(p,k,axis,target)=>{
  const start=(await sample(p)).reconciliation.authoritative[axis];
  if(Math.abs(start-target)<.12)return;
  await key(p,'keyDown',k);
  try{await waitFor(()=>sample(p),s=>target>start?s.reconciliation.authoritative[axis]>=target:s.reconciliation.authoritative[axis]<=target,`Move ${axis} to ${target}`,12000);}
  finally{await key(p,'keyUp',k);}
  await delay(150);
};
const faceEnemy = async p=>{
  const f=await frame(p), hero=f.players.find(h=>h.id===p.id), enemy=f.encounter.enemies[0];
  const dx=enemy.x-hero.x,dz=enemy.z-hero.z,length=Math.hypot(dx,dz);
  assert.ok(length>0 && length<2.5,'A real approach put the hero near the gremlin');
  const thumb=point(p,1,.18,.84);
  await touch(p,'touchStart',[thumb]);await delay(80);
  await touch(p,'touchMove',[{...thumb,x:thumb.x+24*dx/length,y:thumb.y-24*dz/length}]);await delay(180);
  await touch(p,'touchEnd',[]);await delay(100);
};
try{
  server=await startOwnedServer({quiet:true});
  chrome=spawn(process.env.GQ_CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',[
    '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--window-size=1180,820',
    '--disable-background-timer-throttling','--disable-renderer-backgrounding',`--user-data-dir=${profile}`,'about:blank'
  ],{windowsHide:true,stdio:'ignore'});
  const devTools=join(profile,'DevToolsActivePort');
  await waitFor(async()=>existsSync(devTools),Boolean,'Chrome start',15000,100);
  let browserPath;[port,browserPath]=readFileSync(devTools,'utf8').trim().split(/\r?\n/);
  browser=new CDP(`ws://127.0.0.1:${port}${browserPath}`);await browser.ready();
  const createPlayer=async(id,name)=>{
    const {browserContextId}=await browser.send('Target.createBrowserContext');
    const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
    const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
    const p=new CDP(targets.find(t=>t.id===targetId).webSocketDebuggerUrl);await p.ready();pages.push(p);
    for(const api of ['Runtime.enable','Page.enable','Log.enable'])await p.send(api);
    await p.send('Emulation.setDeviceMetricsOverride',{width:1180,height:820,deviceScaleFactor:1,mobile:false});
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await p.send('Storage.clearDataForOrigin',{origin:server.origin,storageTypes:'local_storage'});
    await p.send('Page.addScriptToEvaluateOnNewDocument',{source:bootstrap(id,name)});
    await p.send('Page.navigate',{url:`${server.origin}/unity/`});
    await waitFor(()=>sample(p),Boolean,`Unity join ${name}`,180000,1000);
    p.id=await p.eval('window.__gqUnityCp2Diagnostics.serverFrames.find(frame=>frame.type==="welcome").id');
    p.rect=await p.eval('(()=>{const r=document.querySelector("#unity-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
    console.log(`Connected ${name} ${p.id}`);return p;
  };
  const first=await createPlayer('profile-aaaaaaaa','Younger Review');
  const second=await createPlayer('profile-bbbbbbbb','Older Review');
  await waitFor(()=>frame(first),f=>f.destinationId==='home-hub'&&f.players.length===2,'Shared camp');
  assert.equal((await frame(first)).encounter.enemies.length,0,'The camp is safe');
  await first.send('Page.bringToFront');
  await moveAxis(first,'a','x',-1.4);
  await second.send('Page.bringToFront');
  await moveAxis(second,'d','x',1.4);
  await first.send('Page.bringToFront');
  await capture(first,'01-camp-together');
  checks.camp=await sample(first);
  const travelTap=p=>tap(p,.5-100/p.rect.width,1-55/p.rect.height);
  const arrived=(p,destination)=>waitFor(()=>sample(p),s=>s?.frame.destinationId===destination,'Arrival '+destination);
  await moveAxis(first,'w','z',4.8);
  await key(first,'keyDown','w');
  try {
    await travelTap(first);
    await arrived(first,'emberworks-deep');
    await delay(600);
    const held=await sample(first);
    assert.ok(Math.hypot(held.reconciliation.authoritative.x,held.reconciliation.authoritative.z-4)<.05,'Held movement remains neutral after arrival');
    checks.heldArrival=held;
  } finally { await key(first,'keyUp','w'); }
  await capture(first,'02-entered-emberworks');
  const waiting=await frame(second);
  assert.equal(waiting.destinationId,'home-hub');
  assert.deepEqual(waiting.players.map(p=>p.id),[second.id]);
  assert.equal(waiting.encounter.enemies.length,0);
  checks.separated=waiting;
  await moveAxis(first,'a','x',-4);
  await moveAxis(first,'w','z',6.8);
  await faceEnemy(first);
  await tap(first,.926,.886);
  const hurt=await waitFor(()=>frame(first),f=>f.encounter.enemies[0].hp<30,'Damage shared gremlin');
  const woundedHp=hurt.encounter.enemies[0].hp;
  checks.wounded=hurt;
  await capture(first,'03-wounded-encounter');
  await travelTap(first);
  await arrived(first,'home-hub');
  await waitFor(()=>frame(first),f=>f.players.length===2,'Return to sibling in camp');
  await capture(first,'04-returned-to-camp');
  checks.returned=await sample(first);
  await second.send('Page.bringToFront');
  await moveAxis(second,'w','z',4.8);
  await travelTap(second);
  const secondArrival=await arrived(second,'emberworks-deep');
  assert.equal(secondArrival.frame.encounter.enemies[0].hp,woundedHp,'Leaving a destination does not recreate its encounter');
  await capture(second,'05-sibling-finds-same-fight');
  checks.siblingArrival=secondArrival;
  await first.send('Page.bringToFront');
  await moveAxis(first,'w','z',4.8);
  await travelTap(first);
  await arrived(first,'emberworks-deep');
  const reunion=await waitFor(()=>frame(first),f=>f.players.length===2,'Reunion in the ongoing adventure');
  assert.equal(reunion.encounter.enemies[0].hp,woundedHp);
  checks.reunion=reunion;
  await moveAxis(first,'d','x',1.2);
  await capture(first,'06-reunited-in-emberworks');
  await second.send('Page.bringToFront');
  const previousId=second.id;
  await second.eval(`Object.values(window.__gqUnitySockets.sockets).forEach(socket=>socket.close(1000,'travel review reconnect'))`);
  const reconnected=await waitFor(()=>sample(second),s=>s?.frame.destinationId==='emberworks-deep'&&s.frame.players.some(p=>p.id!==first.id&&p.id!==previousId),'Socket reconnect to last destination',20000,100);
  second.id=reconnected.frame.players.find(p=>p.id!==first.id).id;
  checks.reconnected=reconnected;
  assert.equal(reconnected.frame.encounter.enemies[0].hp,woundedHp);
  await capture(second,'07-reconnected-to-adventure');
  await first.send('Page.bringToFront');
  await travelTap(first);
  await arrived(first,'home-hub');
  await capture(first,'08-camp-after-split');
  checks.finalCamp=await sample(first);
  assert.equal((await frame(second)).destinationId,'emberworks-deep');
  await moveAxis(first,'w','z',2);
  await moveAxis(first,'d','x',8.5);
  await capture(first,'09-camp-edge-default');
  const orbitStart=point(first,4,.54,.55);
  const orbitDistance=(Math.PI/2/.006)*(first.rect.height/600);
  await touch(first,'touchStart',[orbitStart]);
  await delay(80);
  for(let step=1;step<=12;step++){
    await touch(first,'touchMove',[{...orbitStart,x:orbitStart.x+orbitDistance*step/12}]);
    await delay(40);
  }
  await touch(first,'touchEnd',[]);
  await delay(200);
  await capture(first,'10-camp-edge-orbit');
  checks.campEdgeOrbit=await sample(first);
  const errors=pages.flatMap(p=>p.events.filter(e=>e.method==='Runtime.exceptionThrown'||(e.method==='Log.entryAdded'&&e.params.entry.level==='error')));
  writeFileSync(join(output,'report.json'),JSON.stringify({clientSha:sha,serverSha,manifest,origin:server.origin,checks,errors},null,2));
  assert.equal(errors.length,0,'No browser errors');
  console.log(JSON.stringify({sha,output,result:'PASS',checks:Object.keys(checks)}));
}catch(error){
  writeFileSync(join(output,'failure.json'),JSON.stringify({clientSha:sha,serverSha,message:error.stack,checks,clients:await Promise.all(pages.map(async p=>({sample:await sample(p).catch(()=>null),events:p.events})))},null,2));
  for(let i=0;i<pages.length;i++)await capture(pages[i],`failure-${i}`).catch(()=>{});
  throw error;
}finally{
  if(browser)await browser.send('Browser.close').catch(()=>{});
  for(const p of pages)p.ws.close();browser?.ws.close();
  if(chrome&&chrome.exitCode===null)chrome.kill();
  if(server)await server.kill();
}
