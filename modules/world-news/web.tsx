import { defineWebModule } from '@aihot/web/modules';

export const worldNewsWeb=defineWebModule({ name:'world-news',admin:{
  section:{ id:'world',label:'世界新闻',prefix:'/admin/world',landing:'/admin/world/runs' },
  groups:[{ group:'世界新闻',items:[{ to:'/admin/world/runs',label:'运行与统计' },{ to:'/admin/world/models',label:'世界模型' },
    { to:'/admin/world/hot',label:'热点草稿' },{ to:'/admin/world/daily',label:'世界日报' }] }],
} });
