import { defineWebModule } from '@aihot/web/modules';

export const worldNewsWeb=defineWebModule({ name:'world-news',admin:{
  section:{ id:'world',label:'世界新闻',prefix:'/admin/world',landing:'/admin/world/runs' },
  groups:[{ group:'世界新闻',items:[{ to:'/admin/world/runs',label:'运行与统计' }] }],
} });
