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
