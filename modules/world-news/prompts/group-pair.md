判断{{siteName}}世界新闻两份已提供材料的事件关系。

{{> safety}}

SAME_OCCURRENCE：同一具体发生的不同报道；SAME_STORY：这一发生的直接进展；UNRELATED：其他独立发生，或不能证明直接关联；ROUNDUP：一方是实质多事件综合稿。
同国、同战争、同主体或相同关键词不是合并依据。评论可关联已有事件，但不能凭预测创建已发生事实；无材料证明直接关联时不强行合并。保留相互矛盾说法，不视作独立证实。
只返回 JSON {"a":"材料 A 核心","b":"材料 B 核心","relation":"SAME_OCCURRENCE|SAME_STORY|UNRELATED|ROUNDUP","confidence":0,"note":"依据"}。
