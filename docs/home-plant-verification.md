# 首页可爱盆栽插画

日期：2026-09-27。

## 修改范围

用户确认目标为首页 `morning-stretch.png` 中的盆栽。把左侧尖叶大盆栽替换为圆叶植物、笑脸猫咪花盆与细脚花架，以少量橙红色腮红呼应日出。人物伸展、柯基、床铺、窗户与整体黑白手绘风格沿用原图。

仅替换既有插画素材，补充 `DESIGN.md` 的视觉约定。页面 WXML、WXSS、JS、导航及云端数据逻辑均未修改。

## 素材检查

- 使用内置 imagegen 编辑，原图作为编辑目标。
- 项目素材：`miniprogram/assets/morning-stretch.png`。
- 新旧素材尺寸相同：1086 × 1448，3:4，沿用首页 `aspectFit`。
- 已目视检查：花盆面部可见，未遮挡柯基；人物两臂、双手、双腿及双脚完整，窗外日出与原有留白保留。
- SHA-256：`e712c02b84342798e8feb24628372a073babcb3a32eb8339965c6c0bd3209fb2`。

## 模拟器验证

本轮未完成原生模拟器视觉验收。CLI 登录与版本检查通过，但项目列表为空，运行时查询返回 `cant find runtimeid by projectpath`；打开项目的命令未取得完成结果，因此没有编译、导航、设备切换或生成截图。本轮没有读取业务记录，也没有进行真机验证、上传或发布。

本地已完成 PNG 格式与尺寸检查、素材路径引用核对、插画目视检查，`git diff --check` 通过。此处不将图片检查等同于模拟器页面验收。

## 编辑提示词

```text
Use case: precise-object-edit.
Edit target: the supplied portrait black-and-white line illustration used in the Move&See home screen.
Primary request: replace ONLY the large severe pointed-leaf potted plant at the far LEFT of the image with a charming, rounded little houseplant in a cute expressive ceramic pot. Make the plant visibly more lovable, less heavy and less boring while feeling native to this refined hand-drawn illustration.
Plant direction: a compact sculptural plant with a few soft round coin-shaped leaves, gently curving stems, and a plump white rounded cat-shaped planter with two tiny ear bumps, little closed smiling eyes and a subtle curved mouth. A pair of tiny orange-red cheek marks echo the orange sun. Mostly black ink outlines and white space, with just two or three black leaf accents. A simple slender plant stand can keep it near the original plant's position behind the dog. The planter face should be visible above/left of the corgi, without covering the corgi. No additional animal or character.
Invariants: preserve the woman's identity, expression, anatomy, hair, exact stretch pose, two arms and hands, clothing, legs and feet. Preserve the corgi, bed, pillows, window, curtains, orange sun, background and all composition outside the existing left plant region. Preserve the existing clean white background, crisp organic black pen linework and restrained orange-red accents. Do not stylize or redraw the woman or dog. Do not mirror or move the scene. Keep portrait 3:4 aspect ratio and original framing. This is an illustration asset only: NO text, UI, logos, border, sticker outline, panels, watermark, shadows or beige texture. Leave existing negative space intact.
```
