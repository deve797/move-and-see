// 瑜伽双手合十上举后原路放回胸前；跑步完整循环。
const motions = {
  yoga: {
    src: '/assets/yoga-prayer-motion.png', duration: 6400, reverse: true, count: 8,
    // 以实际素材的行间空隙及盘腿中心对齐，保留末帧越过等分线的指尖。
    rows: [0, 424, 887], baselines: [420, 442], centers: [256, 679, 1101, 1524]
  },
  running: { src: '/assets/running-motion.png', duration: 900, reverse: false, count: 8 }
};

function frameAt(kind, elapsed) {
  const motion = motions[kind];
  const progress = (elapsed % motion.duration) / motion.duration;
  if (motion.reverse) {
    return Math.round((1 - Math.cos(progress * Math.PI * 2)) * (motion.count - 1) / 2);
  }
  return Math.floor(progress * motion.count);
}

function frameRect(kind, frame, imageWidth, imageHeight) {
  const motion = motions[kind];
  const row = Math.floor(frame / 4);
  const x = motion.centers ? motion.centers[frame % 4] - imageWidth / 8 : Math.round((frame % 4) * imageWidth / 4);
  const right = motion.centers ? x + imageWidth / 4 : Math.round(((frame % 4) + 1) * imageWidth / 4);
  const y = motion.rows ? motion.rows[row] : row * imageHeight / 2;
  const bottom = motion.rows ? motion.rows[row + 1] : (row + 1) * imageHeight / 2;
  return { x, y, width: right - x, height: bottom - y, baseline: motion.baselines ? motion.baselines[row] : bottom - y };
}

module.exports = { motions, frameAt, frameRect };
