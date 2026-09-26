# 第 23 片：查看最近四周完成率

2026-09-26。依据 `切片.md` 第 23 片实现；本文替代此前验证记录中“四周图表仍为固定示例”的说明。

## 修改与范围

- 新增 `miniprogram/utils/four-week-progress.js`：生成包含本周、由旧到新连续四周的数据；调用已有 `weeklyProgress` 计算每周完成数和有效计划数，不改变本周计算函数。
- `miniprogram/pages/review/index.js`：每次显示页面重新读取本次运行内的临时记录，替换固定四周次数。
- 回看页 WXML/WXSS：四列图改为完成率，显示各周周一日期、完成数 / 有效计划数；本周标注“进行中”。分母为零时不显示百分比或柱条，保留临时记录说明，删除已失效的固定示例说明及对应样式选择器。
- 新增纯函数与页面集成测试各一份，以及本文。

未改 App、今天页、周计划页、记录页及既有测试。未增加持久化、历史选择、更长历史、预测、训练评价，也未重构既有统计逻辑。保留工作区已有改动。

## 计算和缺失数据口径

- 按北京时间日期、周一至周日，以原计划日期归属。四周包括本周及之前三周。
- 正常完成、替代完成及已补做的有效计划各计一次完成；跨周补做只更新原计划周。
- 未来计划和待记录计划计入分母；取消计划、生理期当天免考核计划排除；独立自愿散步不增加分子、分母。
- 完成率为完成数 / 有效计划数 × 100%，四舍五入到整数，页面明确说明。有效计划数大于零但无完成时才显示 0%。
- 当前数据模型没有历史覆盖起点。本轮采用保守规则：过去周没有任何计划记录时显示“无数据”；有计划但全部取消或免考核时显示“无考核计划”；本周无有效计划也显示“无考核计划”。不根据更早的某条计划推断中间空周已有完整历史。
- 统计只读，不修改原始记录；数据仍仅在本次运行内保留，不承诺关闭重开后可回看历史。

## 逐步检查

1. 改动前原有 25 个测试脚本及 `git diff --check` 通过。改前源码副本和哈希清单在 `/private/tmp/move-slice23-before`。
2. 新增计算函数后，立即通过 JS 语法、专项纯函数测试、既有本周进度测试及洛杉矶时区复验。
3. 页面数据接入后，立即检查空运行四周数据，并通过既有结果、原因、心情和备注四项回看测试。
4. 图表接入后，检查动态百分比、分子分母、本周标签、零分母不绘制柱条和固定示例移除。一次临时检查误将原因分布的 `item.count` 也包含在图表搜索范围内；限定图表区后通过，未改动原因分布代码。
5. 页面专项测试调用真实页面方法完成正常记录、替代、未完成、结果修正及跨周补做，验证每次重新进入回看都会刷新，当前周与今天页一致，重复刷新不修改原始数据。
6. 全部 27 个测试脚本通过；两个新测试均在默认时区和 `America/Los_Angeles` 下通过。改动和新增的四个 JS 文件语法检查、`git diff --check` 均通过。
7. WXSS 经 `wechatide compile_wxss` 返回 `success: true`。WXML 的 IDE 调用未返回，改用同一开发者工具安装包自带 `wcc-exec/wcc` 编译回看模板，退出码 0；生成的 JS 语法检查也通过。以上仅证明局部编译通过，不代表模拟器验收。
8. 独立只读审查未发现阻塞项。改前哈希对照确认既有文件仅回看页 JS/WXML/WXSS 变化；本轮新增一个计算函数、两个测试和本文。

## spec 验收对应

| 验收条件 | 结果 |
| --- | --- |
| 包含本周的连续四周，本周“进行中” | 自动测试检查四个日期范围及唯一当前周标记；覆盖北京周日 23:59:59 → 周一 00:00、跨月、跨年和闰日；模板绑定当前周标记 |
| 百分比与完成数、有效计划数一致；跨周补做只更新原周 | 2 / 4 = 50%；真实页面补做后原周 3 / 4 = 75%，补做周自身 1 / 1 = 100% 不变；1 / 3 显示 33%；当前周始终与今天页一致 |
| 缺历史“无数据”；无考核计划不显示 0% 或 100% | 缺历史、全取消、全免考核、空本周分别验证；分母为零时 rate 为 null，模板显示对应文字并省略百分比、柱条 |

复验命令（项目根目录，无需安装依赖）：

```sh
node tests/four-week-progress.test.js
node tests/review-four-weeks.test.js
TZ=America/Los_Angeles node tests/four-week-progress.test.js
TZ=America/Los_Angeles node tests/review-four-weeks.test.js
for test in tests/*.test.js; do node "$test" || exit 1; done
node --check miniprogram/utils/four-week-progress.js
node --check miniprogram/pages/review/index.js
node --check tests/four-week-progress.test.js
node --check tests/review-four-weeks.test.js
git diff --check
```

本机 WXML 复验（从项目根目录执行）：

```sh
cd miniprogram
/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcc -o /private/tmp/move-slice23-review-wxml.js pages/review/index.wxml
node --check /private/tmp/move-slice23-review-wxml.js
```

## 未完成验证与交付边界

第 23 片功能无未实现项，三个验收条件均有自动检查覆盖。320px/375px 模拟器视觉和真机检查尚未完成：开发者工具原生入口窗口显示代码文本，运行时信息和打开项目窗口调用没有返回结果，本轮已中断挂起的 CLI 调用。没有修改开发者工具安装文件、项目配置或用户临时记录来修复环境。

未上传、发布、Git 提交或推送。
