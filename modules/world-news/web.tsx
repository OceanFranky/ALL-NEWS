import { WorldIcon } from './web/world-icon';
import { defineWebModule } from '@aihot/web/modules';

export const worldNewsWeb=defineWebModule({ name:'world-news',sidebar:{ section:'内容',items:[{ to:'/world',label:'世界新闻',icon:WorldIcon }] },
  tabs:[{ key:'world',to:'/world',label:'世界',icon:WorldIcon }],admin:{
  section:{ id:'world',label:'世界新闻',prefix:'/admin/world',landing:'/admin/world/runs' },
  groups:[{ group:'世界新闻',items:[{ to:'/admin/world/content',label:'世界内容' },{ to:'/admin/world/events',label:'世界事件' },{ to:'/admin/world/sources',label:'世界信源' },{ to:'/admin/world/runs',label:'运行与统计' },{ to:'/admin/world/models',label:'世界模型' },
    { to:'/admin/world/hot',label:'热点草稿' },{ to:'/admin/world/daily',label:'世界日报' }] }],
} });
