// Pure ranking: no legacy AI thresholds, vocabulary, provider calls or process-wide section state.
import type { SectionHotPolicy } from '../sections/rules.ts';

export interface SectionHotReport {
  articleId:string;analysisId:number;storyId:number;storyPublicId:string;storyTitle:string;
  sourceId:string;participantKey:string;publishedAt:string;progressAt:string;scores:unknown;contentType:string;
}
export interface SectionHotEntry {
  rank:number;storyId:number;storyPublicId:string;title:string;representativeItemId:string;analysisId:number;
  importance:number;heat:number;sourceCount:number;reportCount:number;latestProgressAt:string;
}

export function rankSectionHot(reports:SectionHotReport[],policy:SectionHotPolicy,at:Date):SectionHotEntry[] {
  const now=at.getTime(),start=now-policy.windowHours*3600000;
  const stories=new Map<number,{ rows:(SectionHotReport & { importance:number })[];participants:Map<string,number>;progress:number }>();
  const seen=new Set<string>();
  for(const row of reports) {
    const time=Date.parse(row.publishedAt),progress=Date.parse(row.progressAt);
    if(seen.has(`${row.storyId}:${row.articleId}`) || !Number.isFinite(time) || time>now
      || !Number.isFinite(progress) || progress>now || !['news_report','institutional_statement'].includes(row.contentType)
      || !Array.isArray(row.scores) || row.scores.length!==2
      || row.scores.some(n=>typeof n!=='number' || !Number.isFinite(n) || n<0 || n>100)) continue;
    seen.add(`${row.storyId}:${row.articleId}`);
    const importance=(row.scores[0]+row.scores[1])/2;
    const story=stories.get(row.storyId) ?? { rows:[],participants:new Map<string,number>(),progress:-Infinity };
    story.rows.push({ ...row,importance });
    if(time>=start) story.participants.set(row.participantKey,Math.max(story.participants.get(row.participantKey) ?? -Infinity,time));
    story.progress=Math.max(story.progress,progress);
    stories.set(row.storyId,story);
  }
  return [...stories.values()].filter(story=>story.participants.size>0).map(story=>{
    story.rows.sort((a,b)=>b.importance-a.importance || Date.parse(a.publishedAt)-Date.parse(b.publishedAt) || a.articleId.localeCompare(b.articleId));
    const best=story.rows[0]!;
    return { rank:0,storyId:best.storyId,storyPublicId:best.storyPublicId,title:best.storyTitle,
      representativeItemId:best.articleId,analysisId:best.analysisId,importance:best.importance,
      heat:[...story.participants.values()].reduce((sum,time)=>sum+0.5**((now-time)/3600000/policy.halfLifeHours),0),
      sourceCount:story.participants.size,reportCount:story.rows.length,latestProgressAt:new Date(story.progress).toISOString() };
  }).sort((a,b)=>b.importance-a.importance || b.heat-a.heat || Date.parse(b.latestProgressAt)-Date.parse(a.latestProgressAt) || a.storyId-b.storyId)
    .slice(0,policy.limit).map((entry,index)=>({ ...entry,rank:index+1 }));
}
