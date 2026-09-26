# 切片 6：记录未完成原因

日期：2026-09-26。范围依据根目录 `切片.md` 的切片 6。

## 本片范围

- 在具体计划的记录页提供“这次未完成”入口和原因单选。原因采用加班、下雨、身体不适、临时有事、其他。
- 必须选中有效原因才能确认；选择中的草稿不写入计划，放弃填写不改变原结果。
- 结果结构为该计划的 `result: { status: 'incomplete', reason: '所选原因' }`。只修改目标 ID，不新增计划，不覆盖已经存在的结果。
- 今天页、周计划显示未完成及对应原因；再次进入记录页可查看原结果。
- 所有安排及结果仅在本次运行内临时保留，关闭重开不保留。

本片不实现补做、生理期例外、原因统计、结果修正或持久化。

## 同目录并行任务边界

本轮发现第 5、7、8 片也在同一工作目录实施，按交接顺序编辑共用文件。第 6 片复用第 5 片的计划 ID 关联和完成结果基础；周计划的未完成原因展示由第 7 片任务协调接入。第 6 片只负责普通未完成录入，结果修正属于第 8 片的独立入口。

## 验证记录

- 修改前，现有切片 1—4 和运动动画五组测试通过。
- 新增 `tests/record-incomplete.test.js`，确认未实现原因选择时验收测试失败，再接入实现。
- 在隔离副本接入记录逻辑后，未完成原因测试通过；独立复核同时通过第 5 片完成记录和今天页计划回归。
- 核对并交接共用文件后，将本片增量接入正式目录，记录页与今天页 JS 语法、未完成原因、完成记录、今天页、切片 1—3、动画测试全部通过；原因测试在 `TZ=America/Los_Angeles` 下也通过。
- 微信开发者工具编译记录页 WXML/WXSS、今天页 WXML 成功。周计划原因展示接入后，未完成、完成和待补记录三个集成测试再次通过；`git diff --check` 通过。

| spec 验收条件 | 自动化检查 | 微信模拟器 |
| --- | --- | --- |
| 普通计划未选择原因不能确认未完成 | 空原因、非法原因、提交时复检均通过 | 实际点击“这次未完成”后，确认按钮的 disabled 为 true |
| 确认后计划显示未完成及对应原因 | 结果写到目标 ID，今天/周计划刷新读取 | 选择“加班”并确认后，记录页、今天页及周计划均显示“未完成 · 加班” |
| 再次进入可见原结果，其他计划不受影响 | 重进、重复确认、已有结果保护、五种原因、两条记录隔离均通过 | 再次打开记录页及通过周计划入口进入，仍为跑步/加班；另一条瑜伽无结果，计划数仍为 2 |

还覆盖暂不记录后清空草稿、不存在/取消计划不可写、填写期间计划被取消或出现其他结果、已有结果不能编辑或取消安排、新运行状态为空。本片普通录入入口不提供结果修正。

本次模拟器逻辑视口 375×603。样例通过已有周计划新增方法填写；记录入口、未完成入口、原因、确认以及周计划结果入口均实际点击。已查看[原因表单](record-incomplete-form.png)与[结果回显](record-incomplete-result.png)，未见内容重叠或横向溢出，短屏内容自然滚动。

取证中一次截图返回 `APPID_ERROR: aborted`，随后模拟器曾回到首页并导致元素查找失败；核对共享计划仍在、重新导航后完成回显和截图复验。错误页面截图已被正确结果截图替换，最终 console 的 error 检索为空。本轮两条临时样例已清除。

```sh
node --check miniprogram/pages/record/index.js
node --check miniprogram/pages/today/index.js
node tests/record-incomplete.test.js
node tests/record-completion.test.js
node tests/today-plans.test.js
node tests/week-add-plan.test.js
node tests/week-edit-plan.test.js
node tests/week-cancel-plan.test.js
node tests/week-pending-record.test.js
node tests/exercise-motion.test.js
TZ=America/Los_Angeles node tests/record-incomplete.test.js
git diff --check
```

第 6 片的三条验收条件均已完成，无本片 spec 遗留项。未进行真机、多尺寸专项验证、Git 提交/推送、上传或发布。
