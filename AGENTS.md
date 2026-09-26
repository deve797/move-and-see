# AGENTS.md

- “Move&See”是个人运动日记微信小程序，品牌名称按此拼写，强调减少日常选择，回看只呈现事实，不作训练指导或评价。
- 使用原生 WXML / WXSS / JavaScript；源码入口由 `project.config.json` 的 `miniprogramRoot` 指定。
- 当前页面已通过 CloudBase 云函数 `moveSeeApi` 接入 `plans`、`day_marks` 集合，实现用户记录的云端持久化；仅云端保存成功后更新页面记录。固定示例保留标识且不入库，不计入真实统计。
- `plan.md` 是产品规划，不是已实现能力清单；`PRODUCT.md` 与验证记录保留历史增量，判断当前行为需核对代码及 `docs/database-connection-verification.md`。云端新增、读回、修改、取消、跑步数据和感受已实际验证；最终权限验收仍在进行，不据此宣称全部验收完成。
- 预览：微信开发者工具导入项目根目录后编译，无需 npm 安装或额外构建步骤。
- 界面任务参考 `DESIGN.md`、`design/README.md`；专项验证参考 `docs/` 中对应记录。运动动画的已有测试命令及范围见 `docs/exercise-motion-verification.md`。
- 交付说明区分模拟器验证、真机验证、上传与发布；开发者工具运行成功不代表已发布。
