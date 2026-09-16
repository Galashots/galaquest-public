import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnityProfileProgression } from '../public/src/unity/profileProgression.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { resolveHeroStats } from '../public/src/progression/heroStats.js';
import { powerFor } from '../public/src/progression/power.js';

const A = 'profile-aaaaaaaa', B = 'profile-bbbbbbbb';
function setup() {
  const saved = new Map([['gq-profiles', JSON.stringify({ v: 1, activeProfileId: A,
    profiles: [{id:A,displayName:'Aster'}, {id:B,displayName:'Bramble'}] })]]);
  const storage = { getItem:key=>saved.get(key)??null, setItem:(key,value)=>saved.set(key,value), removeItem:key=>saved.delete(key) };
  return { saved, storage, bridge:createUnityProfileProgression({storage}) };
}
const award = (heroId, eventId, value = '100') => ({type:'xp-earned',heroId,eventId,value});
const snapshot = events => ({v:4,type:'snapshot',events});

test('a selected child is read without minting or changing device state', () => {
  const {saved,bridge}=setup(), before=[...saved];
  assert.equal(bridge.readSelected().profileId,A);
  assert.deepEqual([...saved],before);
  saved.clear();
  assert.throws(()=>bridge.readSelected(),/Select a child/);
  assert.equal(saved.size,0);
});

test('own live XP is durable, canonical, isolated from the sibling and celebrated once', () => {
  const {storage,bridge}=setup();
  const frame=snapshot([award('p1','combat:a'),award('p2','combat:b','700'),{type:'wolf-defeated',heroId:'p1'}]);
  const result=bridge.applyFrame(A,'p1',frame);
  assert.equal(result.xp,100);
  assert.equal(result.level,2);
  assert.equal(result.maxHp,35);
  assert.equal(result.heroDamage,12);
  assert.equal(result.power,powerFor(resolveHeroStats({totalXp:100})));
  assert.equal(result.powerText,'1,400');
  assert.equal(result.previousPowerText,'1,000');
  assert.equal(result.powerDeltaText,'+400');
  assert.equal(result.gainedXp,100);
  assert.equal(result.leveledUp,true);
  const replay=bridge.applyFrame(A,'p1',frame);
  assert.equal(replay.xp,100);
  assert.equal(replay.gainedXp,0);
  assert.equal(replay.leveledUp,false);
  const profiles=createProfileStore({storage});
  assert.equal(profiles.stateFor(B).xp,0);
  assert.equal(profiles.journalFor(A).length,1);
});

test('post-start earnings survive a fresh bridge and empty server hydration without celebration', () => {
  const {storage,bridge}=setup();
  bridge.applyFrame(A,'p1',snapshot([award('p1','combat:a','250')]));
  const reloaded=createUnityProfileProgression({storage});
  assert.equal(JSON.parse(reloaded.readSelected().factsJson)[0].value,'250');
  const state=reloaded.applyFrame(A,'p3',{v:4,type:'welcome',id:'p3',profileFacts:[],events:[]});
  assert.equal(state.xp,250);
  assert.equal(state.level,3);
  assert.equal(state.gainedXp,0);
  assert.equal(state.leveledUp,false);
});

test('changing the selected sibling does not redirect the running adventure rewards', () => {
  const {saved,storage,bridge}=setup();
  const keyring=JSON.parse(saved.get('gq-profiles'));
  keyring.activeProfileId=B;saved.set('gq-profiles',JSON.stringify(keyring));
  bridge.applyFrame(A,'p1',snapshot([award('p1','combat:a')]));
  assert.equal(bridge.readSelected().profileId,B);
  const profiles=createProfileStore({storage});
  assert.equal(profiles.stateFor(A).xp,100);
  assert.equal(profiles.stateFor(B).xp,0);
});

test('arrival reward history is hydrated once and a wrong-player history cannot enter the journal', () => {
  const {bridge}=setup();
  const facts=[{type:'xp-earned',eventId:'quest:a',value:'450'}];
  assert.throws(()=>bridge.applyFrame(A,'p1',{v:4,type:'welcome',id:'p2',profileFacts:facts}),/different player/);
  assert.equal(JSON.parse(bridge.readSelected().factsJson).length,0);
  const state=bridge.applyFrame(A,'p1',{v:4,type:'destination-changed',id:'p1',profileFacts:facts});
  assert.equal(state.level,4);
  assert.equal(state.leveledUp,false);
  assert.equal(state.gainedXp,0);
});

test('accepted private forge state persists its durable facts without replaying a reward ceremony', () => {
  const {storage,bridge}=setup();
  const entitlement={type:'gear-owned',eventId:`forge-entitlement:${A}:emberworks.rune-forge.magmalord-helmet.v1`,value:'helmet_magmalord'};
  const history={type:'forge-task-completed',eventId:`forge-complete:${A}:emberworks.rune-forge.magmalord-helmet.v1:g2-ir-bird`,value:'{\"taskId\":\"g2-ir-bird\",\"outcome\":\"independent\"}'};
  const state=bridge.applyFrame(A,'p1',{v:4,type:'forge-state',id:'p1',profileFacts:[entitlement,history],events:[],forge:{status:'owned'}});
  assert.deepEqual(state.ownedItemIds,['starter_sword','shield_ironwood','helmet_magmalord']);
  assert.equal(state.gainedXp,0);
  assert.equal(state.leveledUp,false);
  const journal=createProfileStore({storage}).journalFor(A);
  assert.equal(journal.filter(fact=>fact.eventId===entitlement.eventId).length,1);
  bridge.applyFrame(A,'p1',{v:4,type:'forge-state',id:'p1',profileFacts:[entitlement,history],events:[],forge:{status:'owned'}});
  assert.equal(createProfileStore({storage}).journalFor(A).filter(fact=>fact.eventId===entitlement.eventId).length,1);
  assert.throws(()=>bridge.applyFrame(A,'p1',{v:4,type:'forge-state',id:'p2',profileFacts:[entitlement],forge:{}}),/different player/);
});

test('ordinary movement and sibling-only events do not read the device journal', () => {
  const bridge=createUnityProfileProgression({storage:{getItem(){throw new Error('Unexpected hot-path storage read');}}});
  assert.equal(bridge.applyFrame(A,'p1',snapshot([])),null);
  assert.equal(bridge.applyFrame(A,'p1',snapshot([{type:'swing',heroId:'p1'},award('p2','combat:b')])),null);
});

test('short-lived journal reads do not accumulate browser storage listeners', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = [];
  Object.defineProperty(globalThis, 'window', { configurable: true,
    value: { addEventListener: (...args) => listeners.push(args) } });
  try {
    const {bridge} = setup();
    bridge.readSelected();
    bridge.applyFrame(A,'p1',snapshot([award('p1','combat:a')]));
    bridge.applyFrame(A,'p1',snapshot([award('p1','combat:b')]));
    assert.equal(listeners.length, 0, 'ephemeral stores must not retain their keyrings in page listeners');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('a device that refuses a save does not report successful reward persistence', () => {
  const {storage}=setup();
  const bridge=createUnityProfileProgression({storage:{...storage,setItem(){throw new Error('Quota exceeded');}}});
  assert.throws(()=>bridge.applyFrame(A,'p1',snapshot([award('p1','combat:a')])),/could not save/);
});

// Exercise the addressed producer payload before any welcome/reload can mask a
// missing pet-state journal write, as happened in the built sibling review.
const petFacts = (profileId, petId = 'worm_green', rev = 0, value = petId) => [
  {type:'pet-owned',eventId:`pet-owned:${profileId}:${petId}`,value:petId},
  {type:'pet-equipped',eventId:`pet-equip:${profileId}:review-${rev}`,value,rev},
];
const petFrame = (id, profileFacts) => ({v:4,type:'pet-state',id,worldEpoch:0,profileFacts,events:[]});

test('live private pet choices reach both device journals before reload or backend loss', () => {
  const {storage,bridge}=setup();
  const before=bridge.applyFrame(A,'p1',{v:4,type:'welcome',id:'p1',profileFacts:[]});
  bridge.applyFrame(A,'p1',petFrame('p1',petFacts(A,'worm_red')));
  const sibling=bridge.applyFrame(B,'p2',petFrame('p2',petFacts(B)));
  for (const [profileId,petId] of [[A,'worm_red'],[B,'worm_green']]) {
    const profiles=createProfileStore({storage});
    const journal=profiles.journalFor(profileId);
    assert.deepEqual(journal.filter(f=>f.type==='pet-owned').map(f=>f.value),[petId]);
    assert.equal(journal.find(f=>f.type==='pet-equipped').value,petId);
    const restored=createUnityProfileProgression({storage}).applyFrame(profileId,'new-player',
      {v:4,type:'welcome',id:'new-player',profileFacts:[],events:[]});
    assert.deepEqual(JSON.parse(restored.factsJson),journal,'empty server cannot erase live pet facts');
    for (const key of ['xp','coins','marks','shards','power']) assert.equal(restored[key],before[key],key);
  }
  assert.equal(sibling.gainedXp,0); assert.equal(sibling.leveledUp,false);
});

test('private pet-state remains addressed, idempotent and honest about failed saves', () => {
  const {storage,bridge}=setup();
  const frame=petFrame('p1',petFacts(A));
  assert.throws(()=>bridge.applyFrame(A,'p2',frame),/different player/);
  assert.equal(createProfileStore({storage}).journalFor(A).length,0);
  bridge.applyFrame(A,'p1',frame);
  const first=createProfileStore({storage}).journalFor(A);
  const replay=bridge.applyFrame(A,'p1',frame);
  assert.deepEqual(JSON.parse(replay.factsJson),first);
  assert.equal(createProfileStore({storage}).journalFor(B).length,0);
  assert.equal(replay.gainedXp,0); assert.equal(replay.leveledUp,false);
  const fresh=setup();
  const blocked=createUnityProfileProgression({storage:{...fresh.storage,setItem(){throw new Error('Quota exceeded');}}});
  assert.throws(()=>blocked.applyFrame(A,'p1',frame),/could not save/);
  assert.equal(createProfileStore({storage:fresh.storage}).journalFor(A).length,0);
});

test('rest and follow revisions are saved from private replies without currency ceremonies', () => {
  const {storage,bridge}=setup();
  const initial=bridge.applyFrame(A,'p1',petFrame('p1',petFacts(A)));
  const rest={type:'pet-equipped',eventId:`pet-equip:${A}:review-1`,value:'none',rev:1};
  const follow={type:'pet-equipped',eventId:`pet-equip:${A}:review-2`,value:'worm_green',rev:2};
  bridge.applyFrame(A,'p1',petFrame('p1',[...petFacts(A),rest]));
  const after=bridge.applyFrame(A,'p1',petFrame('p1',[...petFacts(A),rest,follow]));
  assert.deepEqual(createProfileStore({storage}).journalFor(A).filter(f=>f.type==='pet-equipped').map(f=>f.rev).sort(),[0,1,2]);
  for (const key of ['xp','coins','marks','shards','power']) assert.equal(after[key],initial[key],key);
  for (const key of ['gainedXp','gainedCoins','gainedMarks']) assert.equal(after[key],0,key);
});
