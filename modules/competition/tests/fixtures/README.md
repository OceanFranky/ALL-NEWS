# OCR 固定素材

`official-contest-2025.png` 和 `official-contest-2026.png` 是测试用的合成文字图片，仅包含白底黑字 `OFFICIAL CONTEST 2025`／`OFFICIAL CONTEST 2026`，不是真实竞赛资料。

直接读取固定 PNG 像素，避免测试时用系统字体渲染 SVG：macOS 与 Linux 的默认 sans-serif 不同，曾导致 CI 将 2025 识别为 20225。测试仍使用真实离线 OCR，并严格核对可见年份，不放宽生产识别或来源规则。
