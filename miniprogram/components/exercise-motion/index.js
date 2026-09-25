const { motions, frameAt, frameRect } = require('../../utils/exercise-motion');

Component({
  properties: {
    kind: { type: String, value: 'yoga' }
  },
  data: { ready: false },
  lifetimes: {
    attached() {
      this._pageVisible = true;
      this._visible = false;
      this._elapsed = 0;
      this._lastFrame = -1;
    },
    ready() {
      this.createSelectorQuery().select('#motion').fields({ node: true, size: true }).exec(result => {
        if (this._detached || !result[0] || !result[0].node) return;
        const { node, width, height } = result[0];
        this._canvas = node;
        const ratio = Math.min(wx.getWindowInfo().pixelRatio, 2);
        node.width = Math.round(width * ratio);
        node.height = Math.round(height * ratio);
        this._ctx = node.getContext('2d');
        const picture = node.createImage();
        picture.onload = () => {
          if (this._detached) return;
          this._picture = picture;
          this.drawFrame(0);
          this.setData({ ready: true });
          this._observer = this.createIntersectionObserver({ thresholds: [0, 0.01] });
          this._observer.relativeToViewport().observe('.motion-art', entry => {
            this._visible = entry.intersectionRatio > 0;
            this.updatePlayback();
          });
        };
        // 资源异常时保留 slot 中的原插画，卡片仍可正常操作。
        picture.onerror = () => { this.stopPlayback(); };
        picture.src = motions[this.data.kind].src;
      });
    },
    detached() {
      this._detached = true;
      this.stopPlayback();
      if (this._observer) this._observer.disconnect();
      this._picture = null;
      this._ctx = null;
      this._canvas = null;
    }
  },
  pageLifetimes: {
    show() { this._pageVisible = true; this.updatePlayback(); },
    hide() { this._pageVisible = false; this.stopPlayback(); }
  },
  methods: {
    updatePlayback() {
      if (!this._picture || this._detached || !this._pageVisible || !this._visible) {
        this.stopPlayback();
        return;
      }
      if (this._playing) return;
      this._playing = true;
      this._lastTime = Date.now();
      const tick = () => {
        if (!this._playing) return;
        const now = Date.now();
        this._elapsed += now - this._lastTime;
        this._lastTime = now;
        this.drawFrame(frameAt(this.data.kind, this._elapsed));
        this._raf = this._canvas.requestAnimationFrame(tick);
      };
      this._raf = this._canvas.requestAnimationFrame(tick);
    },
    stopPlayback() {
      this._playing = false;
      if (this._canvas && this._raf != null) this._canvas.cancelAnimationFrame(this._raf);
      this._raf = null;
    },
    drawFrame(frame) {
      if (frame === this._lastFrame) return;
      this._lastFrame = frame;
      const { width, height } = this._canvas;
      const rect = frameRect(this.data.kind, frame, this._picture.width, this._picture.height);
      const scale = Math.min(width, height) / (this._picture.width / 4 * 1.12);
      this._ctx.clearRect(0, 0, width, height);
      this._ctx.drawImage(this._picture,
        rect.x, rect.y, rect.width, rect.height,
        (width - rect.width * scale) / 2, height - 12 * (height / 200) - rect.baseline * scale,
        rect.width * scale, rect.height * scale);
    }
  }
});
