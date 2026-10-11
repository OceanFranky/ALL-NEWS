import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankSectionHot,type SectionHotReport } from '@aihot/backend/events/section-hot-rank';
import { WORLD_HOT_POLICY } from '../hot-policy.ts';

const at=new Date('2026-10-11T12:00:00Z');
const time=(hours:number)=>new Date(at.getTime()-hours*3600000).toISOString();
const row=(storyId:number,source:string,hours:number,scores:unknown=[80,80],progress=hours):SectionHotReport=>({
  articleId:`${storyId}-${source}-${hours}`,analysisId:1,storyId,storyPublicId:String(storyId),storyTitle:'事件',sourceId:source,
  participantKey:source,publishedAt:time(hours),progressAt:time(progress),scores,contentType:'news_report' });

test('importance leads heat; an active event retains older qualified peak scores',()=>{
  const items=rankSectionHot([row(1,'a',72,[92,90]),row(1,'b',1,[60,60]),
    row(2,'a',0,[90,90]),row(2,'b',0,[90,90]),row(2,'c',0,[90,90])],WORLD_HOT_POLICY,at);
  assert.deepEqual(items.map(e=>e.storyId),[1,2]);assert.equal(items[0]!.importance,91);
  assert.equal(items[0]!.sourceCount,1);assert.equal(items[0]!.reportCount,2);
});
test('independent source groups count once, with 24-hour decay and an inclusive 48-hour window',()=>{
  const entries=rankSectionHot([row(1,'a',24),row(1,'a',48),row(1,'b',48),row(2,'a',48.01)],WORLD_HOT_POLICY,at);
  assert.equal(entries.length,1);assert.equal(entries[0]!.sourceCount,2);assert.equal(entries[0]!.heat,0.75);
});
test('equal importance and heat use latest direct progress, not latest repeated coverage',()=>{
  const entries=rankSectionHot([row(1,'a',0,[80,80],10),row(2,'a',0,[80,80],1)],WORLD_HOT_POLICY,at);
  assert.deepEqual(entries.map(e=>e.storyId),[2,1]);
});
test('comments, malformed or single scores, future and inactive evidence never produce a ranking',()=>{
  const comment={ ...row(1,'a',0,[100,100]),contentType:'opinion_analysis' };
  const entries=rankSectionHot([comment,row(2,'a',0,[90]),row(3,'a',0,['90',90]),row(4,'a',0,[NaN,90]),
    row(5,'a',-1),row(6,'a',49),row(7,'a',0,[101,90])],WORLD_HOT_POLICY,at);
  assert.deepEqual(entries,[]);
});
test('repeated memberships do not increase report counts; capacity and tie order are stable',()=>{
  const a=row(1,'a',0),reports=[a,a,...Array.from({ length:15 },(_,i)=>row(i+2,'b',0))];
  const entries=rankSectionHot(reports,WORLD_HOT_POLICY,at);
  assert.equal(entries.length,10);assert.equal(entries[0]!.reportCount,1);
  assert.deepEqual(entries.map(e=>e.rank),Array.from({ length:10 },(_,i)=>i+1));
});
