# Move&See 跑步女性图标 v4

生成方式：内置 image_gen。以 app-icon-runner-v3.png 为编辑目标，将文字下移缩小，以适配居中圆形头像裁切。

成品：app-icon-runner-v4.png，1254 × 1254。

## 圆形裁切检查

对成品进行只读像素检查：顶部文字的深色像素范围 x=384..870，y=101..179；居中内切圆之外的文字像素数为 0。换算至 144 × 144 显示尺寸，文字像素距圆边的最小径向余量约 5.9 像素。此为本地几何检查，未操作微信后台上传。

## 最终提示词

Use case: precise-object-edit / typography layout correction.
Edit this exact square app icon to correct its brand-word placement for WeChat's circular avatar crop. The text is presently too close to the top and clipped by the inscribed circle.
Change ONLY the lettering layout and its orange underline. Keep the runner, face, natural slender proportions, cap, high ponytail, sportswear, pose, park railing, plants, distant skyline, line art style, colors, and opaque white square background unchanged.

Exact single-line text: "Move&See", no spaces, exact spelling/capitalization.
Move the title DOWN and make it about 25 percent smaller than it is now. Center it horizontally. All black letter pixels must fit within a safe rectangular box: x = 29% to 71% of the canvas; y = 9% to 15.5% of the canvas. This box lies safely within the circular avatar. The topmost visible black letter pixels must be at least 9 percent of the image height below the top edge. Do NOT leave any old lettering at the original top edge.
Retain the same elegant bold black serif font. Retain a much shorter orange-red curved underline beneath the LEFT part of the wordmark (roughly beneath "Move"), in the white space at x=32% to 49%, around y=17%, clear of the cap. The underline should be delicate. Make sure no text or underline touches the cap or hair.
Do not add a visible circle, safety guides, crop border, UI or any other new element. Deliver one finished SQUARE upload image, not a circular file or mockup. The whole title must be completely visible after a centered circular crop, with generous safety space between letters and that invisible circle edge.
