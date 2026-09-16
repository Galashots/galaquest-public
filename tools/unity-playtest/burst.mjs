// Built-client Burst integration: fixture levels, real inputs, exact source and isolated cleanup.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';
import { createProfileStore } from '../../public/src/progression/profiles.js';
import { cumulativeXpForLevel } from '../../public/src/progression/levels.js';

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
const mode='--burst';
assert.match(suffix, /^[a-z0-9-]*$/);
const output = resolve(`.local/unity-playtest/burst-${sha.slice(0,7)}${suffix}`);
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gq-burst-chrome-'));
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
let completed=false,failure=null;
const pages=[];
const checks={};
const bootstrap = (id,name) => {
  const fixture = new Map([['gq-profiles',JSON.stringify({v:1,activeProfileId:id,profiles:[{id,displayName:name}]})]]);
  const storage = {getItem:key=>fixture.get(key)??null,setItem:(key,value)=>fixture.set(key,value)};
  createProfileStore({storage,watchStorageEvents:false}).ingestServerFacts(id,[{type:'xp-earned',eventId:'review:burst-level:'+id,value:String(cumulativeXpForLevel(id==='profile-aaaaaaaa'?5:4))}]);
  return `
  if(location.origin===${JSON.stringify(server.origin)}) {
  if(!localStorage.getItem('gq-profiles')) {
    for(const [key,value] of ${JSON.stringify([...fixture])})localStorage.setItem(key,value);
  }
  window.__burstSends=[]; const originalSend=WebSocket.prototype.send;
  WebSocket.prototype.send=function(data){try{const m=JSON.parse(data);if(m.type==='special'||m.type==='attack')window.__burstSends.push(m);}catch{}return originalSend.call(this,data);};
  window.__fightAudio={contexts:[],starts:0};
  const Native=window.AudioContext;
  if(Native)window.AudioContext=new Proxy(Native,{construct(target,args){
    const context=new target(...args);window.__fightAudio.contexts.push(context);
    const create=context.createBufferSource.bind(context);
    context.createBufferSource=function(){const node=create();const start=node.start.bind(node);node.start=function(...args){window.__fightAudio.starts++;return start(...args)};return node};
    return context;
  }});
  }
`;
};
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
  // Destination acknowledgements can precede Unity's next input update. Release and
  // observe fresh rendered reconciliation before beginning this NEW movement gesture;
  // the separate held-arrival test deliberately keeps its old gesture down.
  await key(p,'keyUp',k);
  const releasedAt=(await sample(p)).reconciliation.atMs;
  await waitFor(()=>sample(p),s=>s.reconciliation.atMs>releasedAt+60,'Neutral input frame');
  await key(p,'keyDown',k);
  try{await waitFor(()=>sample(p),s=>target>start?s.reconciliation.authoritative[axis]>=target:s.reconciliation.authoritative[axis]<=target,`Move ${axis} to ${target}`,12000);}
  finally{await key(p,'keyUp',k);}
  await delay(150);
};
const faceEnemy = async p=>{
  const f=await frame(p), hero=f.players.find(h=>h.id===p.id), enemy=f.encounter.enemies.find(e=>e.kind==='lava-gremlin');
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
  const endpoint=await waitFor(async()=>{
    try{return readFileSync(devTools,'utf8').trim().split(/\r?\n/);}
    catch(error){if(['ENOENT','EBUSY'].includes(error.code))return null;throw error;}
  },value=>value?.length===2&&Number(value[0])>0,'Chrome endpoint readable',15000,100);
  let browserPath;[port,browserPath]=endpoint;
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
  const first=await createPlayer('profile-aaaaaaaa','Level Five Review');
  const second=await createPlayer('profile-bbbbbbbb','Level Four Review');
  const progression=p=>p.eval('window.__gqUnityCp2Diagnostics?.latestProgression ?? null');
  const sent=p=>p.eval('window.__burstSends');
  const self=(p,f)=>f.encounter.heroes[p.id];
  await waitFor(()=>progression(first),s=>s?.level===5,'Level-5 fixture restored');
  await waitFor(()=>progression(second),s=>s?.level===4,'Level-4 fixture restored');
  await second.send('Page.bringToFront');
  await key(second,'keyDown','k');await delay(150);await key(second,'keyUp','k');
  assert.equal((await sent(second)).filter(m=>m.type==='special').length,0,'Level 4 cannot emit a special');
  checks.locked={progression:await progression(second),sent:await sent(second)};
  await capture(second,'01-level-four-locked');
  await first.send('Page.bringToFront');
  await moveAxis(first,'w','z',4.8);
  await tap(first,.5-100/first.rect.width,1-55/first.rect.height);
  await waitFor(()=>frame(first),f=>f.destinationId==='emberworks-deep','Travel to combat');
  await moveAxis(first,'a','x',-4);await moveAxis(first,'w','z',6.8);
  await faceEnemy(first);
  const before=await frame(first), enemyId=before.encounter.enemies.find(e=>e.kind==='lava-gremlin').enemyId;
  checks.keyboardBefore=before;
  await capture(first,'02-ready-facing-enemy');
  await key(first,'keyDown','k');await delay(100);await key(first,'keyUp','k');
  const fired=await waitFor(()=>frame(first),f=>self(first,f)?.specialCooldown>0,'Authoritative special cooldown');
  const hit=await waitFor(()=>frame(first),f=>f.encounter.enemies.find(e=>e.enemyId===enemyId)?.hp<before.encounter.enemies.find(e=>e.enemyId===enemyId).hp,'Special damages the actual target');
  checks.keyboard={fired,hit,sent:await sent(first)};
  assert.equal(checks.keyboard.sent.filter(m=>m.type==='special').length,1,'One deliberate K press');
  assert.equal(checks.keyboard.sent.filter(m=>m.type==='attack').length,0,'Burst is not ordinary attack');
  await capture(first,'03-special-hit');
  await waitFor(()=>frame(first),f=>self(first,f)?.specialCooldown===0&&self(first,f)?.specialSeconds<0,'Cooldown finishes',14000);
  await first.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await first.eval(`(()=>{const c=document.querySelector('#unity-canvas'),box=document.querySelector('#unity-container');
    document.body.style.margin='0';box.style.cssText='position:fixed;left:0;top:0;width:390px;height:844px;transform:none';
    c.style.width='390px';c.style.height='844px';c.width=390;c.height=844;
    const footer=document.querySelector('#unity-footer');if(footer)footer.style.display='none';})()`);
  checks.viewport=await waitFor(()=>first.eval(`(()=>{const c=document.querySelector('#unity-canvas');return {width:c.width,height:c.height}})()`),v=>v.width===390&&v.height===844,'Portrait backbuffer');
  await delay(500);
  first.rect=await first.eval('(()=>{const r=document.querySelector("#unity-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
  await capture(first,'04-portrait-ready');
  const position=(await sample(first)).reconciliation.authoritative;
  const thumb=point(first,7,164/390,794/844);
  await touch(first,'touchStart',[thumb]);await delay(100);
  await touch(first,'touchMove',[{...thumb,x:thumb.x+70,y:thumb.y-100}]);await delay(350);
  await touch(first,'touchEnd',[]);await delay(150);
  const after=(await sample(first)).reconciliation.authoritative;
  const messages=await sent(first);
  assert.equal(messages.filter(m=>m.type==='special').length,2,'Portrait touch emits once; hold/drag does not repeat');
  assert.equal(messages.filter(m=>m.type==='attack').length,0,'Special touch cannot emit ordinary attack');
  assert.ok(Math.hypot(after.x-position.x,after.z-position.z)<.12,'Burst edge/drag cannot take the joystick');
  checks.portrait={position,after,sent:messages,frame:await frame(first)};
  await capture(first,'05-portrait-touch-cooldown');
  const earned=await progression(first);
  await first.send('Page.reload',{ignoreCache:true});
  const restored=await waitFor(()=>progression(first),s=>s?.level===5&&s.xp===earned.xp,'Level-5 journal reload',180000,1000);
  assert.equal(restored.leveledUp,false,'Reload is not a new level-up ceremony');
  checks.reload={earned,restored};await capture(first,'06-level-five-reloaded');
  const errors=pages.flatMap(p=>p.events.filter(e=>e.method==='Runtime.exceptionThrown'||
    (e.method==='Log.entryAdded'&&e.params.entry.level==='error')));
  checks.browserErrors=errors;assert.equal(errors.length,0,'No browser runtime errors');
  completed=true;
}catch(error){
  failure=String(error.stack??error);
  for(let i=0;i<pages.length;i++)await capture(pages[i],`failure-${i}`).catch(()=>{});
}finally{
  let clean=true;const cleanupErrors=[];
  if(browser)await browser.send('Browser.close').catch(()=>{});
  for(const p of pages)p.ws.close();browser?.ws.close();
  if(chrome&&chrome.exitCode===null){
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),delay(3000)]);
    if(chrome.exitCode===null){chrome.kill();await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),delay(3000)]);}
  }
  if(server) {
    let stopped=await server.kill();
    if(!stopped){await delay(1500);stopped=await server.kill();}
    if(!stopped){clean=false;cleanupErrors.push('Owned server exit/port release not verified');}
  }
  try{rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:500});}
  catch(error){
    // Allow pending child-exit events to run after the synchronous filesystem retry.
    await delay(100);
    // Windows can refuse Node's recursive removal after Chrome has exited even when
    // the same user's native deletion succeeds. No ACL or permission changes.
    try {
      assert.equal(process.platform,'win32');
      assert.ok(chrome,'No owned browser identity');
      if(chrome.exitCode===null && chrome.signalCode===null)
        await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),delay(5000)]);
      assert.ok(chrome.exitCode!==null || chrome.signalCode!==null,'Do not delete a live browser profile');
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
        'Remove-Item -LiteralPath $env:GQ_OWNED_PROFILE -Recurse -ErrorAction Stop'],
        {env:{...process.env,GQ_OWNED_PROFILE:profile},timeout:20000,stdio:'pipe'});
      assert.equal(existsSync(profile),false,'Owned profile removal must be verified');
    } catch(cleanupError){clean=false;cleanupErrors.push(error.message+'; '+cleanupError.message);}
  }
  const result=completed&&!failure&&clean?'PASS':'FAIL';
  const report={clientSha:sha,serverSha,mode,manifest,origin:server?.origin,checks,
    result,failure,cleanup:{passed:clean,profile,chromePid:chrome?.pid,chromeExitCode:chrome?.exitCode,chromeSignalCode:chrome?.signalCode,errors:cleanupErrors},
    limits:['Synthetic Level-5 integration, not natural first-15 pacing','Emulated viewport, not physical iPad','Captures require visual inspection']};
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({clientSha:sha,serverSha,result,output,failure,cleanup:report.cleanup}));
  if(result!=='PASS')process.exitCode=1;
}
