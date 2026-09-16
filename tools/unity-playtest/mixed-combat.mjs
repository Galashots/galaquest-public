// Integrated Emberworks counterplay: real dodge/standing controls and one Burst against both roles.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';
import { createProfileStore } from '../../public/src/progression/profiles.js';
import { specialAttackTargets } from '../../public/src/combat/specialAttack.js';
import { enemyStatsForLevel } from '../../public/src/combat/enemyStats.js';
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
const mode='--mixed-combat';
assert.match(suffix, /^[a-z0-9-]*$/);
const output = resolve(`.local/unity-playtest/mixed-${sha.slice(0,7)}${suffix}`);
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gq-mixed-chrome-'));
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
  const first=await createPlayer('profile-aaaaaaaa','Mixed Combat Review');
  await first.send('Page.bringToFront');
  await waitFor(()=>first.eval('window.__gqUnityCp2Diagnostics?.latestProgression'),s=>s?.level===5,'Level-5 fixture');
  const alpha=f=>f.encounter.enemies.find(e=>e.enemyId==='emberworks-alpha-1');
  const hero=f=>f.encounter.heroes[first.id];
  const body=f=>f.players.find(p=>p.id===first.id);
  await moveAxis(first,'w','z',4.8);await tap(first,.5-100/first.rect.width,1-55/first.rect.height);
  await waitFor(()=>frame(first),f=>f.destinationId==='emberworks-deep','Enter Emberworks');
  assert.ok(alpha(await frame(first)),'This proof requires the integrated authored heavy');
  await moveAxis(first,'d','x',4);await moveAxis(first,'w','z',6.8);
  const windup=await waitFor(()=>frame(first),f=>alpha(f)?.mode==='bite'&&alpha(f).modeSeconds<.2,'Fresh committed heavy windup',18000);
  checks.dodgeBefore=windup;
  const heading=alpha(windup).heading;const hp=hero(windup).hp;
  // Begin the dodge before screenshot work; observing pixels must not consume the telegraph.
  const dodgeKey=Math.abs(Math.sin(heading))>Math.abs(Math.cos(heading))?'w':'d';
  await key(first,'keyDown',dodgeKey);
  const windupShot=capture(first,'01-heavy-windup');
  try {await delay(650);} finally {await key(first,'keyUp',dodgeKey);}
  await windupShot;
  const dodgeFrames=[];
  const missed=await waitFor(async()=>{const f=await frame(first);dodgeFrames.push(f);return f;},
    f=>alpha(f)?.mode!=='bite','Heavy exits committed attack',5000);
  checks.dodge={before:windup,after:missed,frames:dodgeFrames,dodgeKey};
  assert.ok(hero(missed).hp>=hp,'A real sidestep avoids heavy contact damage');
  assert.ok(dodgeFrames.filter(f=>alpha(f).mode==='bite').every(f=>Math.abs(alpha(f).heading-heading)<.001),'Windup does not track the dodging player');
  checks.dodge={before:windup,after:missed,frames:dodgeFrames};await capture(first,'02-heavy-missed');
  const returnX=4;
  await moveAxis(first,(body(await frame(first)).x>returnX?'a':'d'),'x',returnX);
  const standing=await waitFor(()=>frame(first),f=>alpha(f)?.mode==='bite'&&alpha(f).modeSeconds<.2,'Standing contact control',18000);
  await capture(first,'03-standing-windup');
  const contact=await waitFor(()=>frame(first),f=>hero(f).hp<hero(standing).hp,'Heavy standing hit',4000);
  checks.standing={before:standing,contact};await capture(first,'04-heavy-contact');
  assert.equal(hero(standing).hp-hero(contact).hp,enemyStatsForLevel('alpha-wolf',alpha(standing).level).biteDamage,'Standing still takes one authoritative heavy hit');
  const recovery=await waitFor(()=>frame(first),f=>alpha(f)?.mode==='idle','Heavy recovery',4000);
  checks.standing.recovery=recovery;await capture(first,'05-heavy-recovery');
  // Recover through the ordinary camp route before testing the second mechanic. No HP mutation.
  await tap(first,.5-100/first.rect.width,1-55/first.rect.height);
  await waitFor(()=>frame(first),f=>f.destinationId==='home-hub','Return to the safe camp');
  checks.rest=await waitFor(()=>frame(first),f=>hero(f).hp===hero(f).maxHp,'Natural camp recovery',25000);
  await moveAxis(first,'w','z',4.8);await tap(first,.5-100/first.rect.width,1-55/first.rect.height);
  await waitFor(()=>frame(first),f=>f.destinationId==='emberworks-deep','Return to the ongoing mixed encounter');
  await moveAxis(first,(body(await frame(first)).x>0?'a':'d'),'x',0);
  await moveAxis(first,(body(await frame(first)).z>7.3?'s':'w'),'z',7.3);
  await key(first,'keyDown','w');await delay(80);await key(first,'keyUp','w');
  const grouped=await waitFor(()=>frame(first),f=>{
    const p=body(f), enemies=f.encounter.enemies.filter(e=>e.hp>0);
    return hero(f).hp>0 && enemies.length>=2 && specialAttackTargets(enemies,p,p.heading).length>=2;
  },'Both real enemy roles enter the forward Burst cone',12000);
  const targets=grouped.encounter.enemies.filter(e=>e.hp>0);checks.mixedBefore=grouped;
  await capture(first,'06-mixed-ready');
  await key(first,'keyDown','k');await delay(100);await key(first,'keyUp','k');
  const burst=await waitFor(()=>frame(first),f=>targets.every(t=>f.encounter.enemies.find(e=>e.enemyId===t.enemyId)?.hp<t.hp),'One Burst damages both enemy roles',5000);
  const sends=await first.eval('window.__burstSends');
  assert.equal(sends.filter(m=>m.type==='special').length,1,'One deliberate press handles the mixed group');
  assert.equal(sends.filter(m=>m.type==='attack').length,0);
  checks.mixed={after:burst,sends};await capture(first,'07-mixed-burst-hit');
  const errors=pages.flatMap(p=>p.events.filter(e=>e.method==='Runtime.exceptionThrown'||(e.method==='Log.entryAdded'&&e.params.entry.level==='error')));
  checks.browserErrors=errors;assert.equal(errors.length,0,'No built-client runtime errors');
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
  if(server&&!await server.kill()){clean=false;cleanupErrors.push('Owned server exit/port release not verified');}
  try{rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:500});}
  catch(error){clean=false;cleanupErrors.push(error.message);}
  const result=completed&&!failure&&clean?'PASS':'FAIL';
  const report={clientSha:sha,serverSha,mode,manifest,origin:server?.origin,checks,
    result,failure,cleanup:{passed:clean,profile,errors:cleanupErrors},
    limits:['Synthetic Level-5 integration, not natural first-15 pacing','Emulated viewport, not physical iPad','Captures require visual inspection']};
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({clientSha:sha,serverSha,result,output,failure,cleanup:report.cleanup}));
  if(result!=='PASS')process.exitCode=1;
}
