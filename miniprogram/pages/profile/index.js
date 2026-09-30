const avatarLimit = 512 * 1024;

function localFileInfo(filePath) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject }));
}

Page({
  onShareAppMessage: require('../../utils/share'),
  data: {
    profile: null, loading: true, loadError: '', editing: false,
    draftNickname: '', nicknameCount: 0, nicknameFocused: false, nicknameError: '', canSave: false,
    draftAvatarUrl: '', avatarFailed: false, avatarReading: false, avatarError: '',
    saving: false, saveError: '', saveConflict: false
  },
  async onShow() {
    if (this.data.editing || this.data.saving || this._loading) return;
    this._loading = true;
    this.setData({ loading: true, loadError: '' });
    try {
      this.renderProfile(await getApp().loadProfile());
    } catch (error) {
      this.setData({ loadError: error.message || '暂时无法读取资料，请重试。' });
    } finally {
      this._loading = false;
      this.setData({ loading: false });
    }
  },
  retryLoad() { return this.onShow(); },
  renderProfile(profile) {
    this._profile = { ...profile };
    this._avatarBase64 = undefined;
    this.setData({
      profile: { ...profile }, editing: false,
      draftNickname: profile.nickname, nicknameCount: Array.from(profile.nickname).length,
      draftAvatarUrl: profile.avatarUrl, avatarFailed: false, avatarError: '',
      nicknameFocused: false, nicknameError: '', canSave: false, saveError: '', saveConflict: false
    });
  },
  startEditing() {
    if (!this._profile || this.data.loading || this.data.loadError || this.data.saving) return;
    this.setData({ editing: true });
  },
  cancelEditing() {
    if (this.data.saving || this.data.avatarReading) return;
    this.renderProfile(this._profile);
  },
  updateCanSave() {
    const nickname = this.data.draftNickname.trim();
    const count = Array.from(nickname).length;
    const changed = nickname !== this._profile.nickname || this._avatarBase64 !== undefined;
    this.setData({ nicknameCount: count, canSave: count > 0 && count <= 20 && changed && !this.data.nicknameError });
  },
  inputNickname(event) {
    if (!this.data.editing || this.data.saving) return;
    this.setData({ draftNickname: event.detail.value, nicknameError: '' });
    this.updateCanSave();
  },
  focusNickname() { this.setData({ nicknameFocused: true }); },
  blurNickname(event) {
    this.inputNickname(event);
    this.setData({ nicknameFocused: false });
  },
  onNicknameReview(event) {
    if (!this.data.editing || this.data.saving) return;
    const { pass, timeout } = event.detail;
    this.setData({ nicknameError: timeout ? '昵称暂未校验完成，请重新填写后重试' : pass ? '' : '昵称未通过校验，请重新填写' });
    this.updateCanSave();
  },
  submitProfile(event) {
    if (!this.data.editing || this.data.saving || this.data.nicknameError) return;
    // 原生昵称组件可能在校验后清空输入，提交时以表单的实际值为准。
    this.inputNickname({ detail: { value: event.detail.value.nickname || '' } });
    if (!this.data.draftNickname.trim()) {
      this.setData({ nicknameError: '请填写昵称后再保存' });
      this.updateCanSave();
      return;
    }
    return this.confirmProfile();
  },
  async chooseAvatar(event) {
    if (!this.data.editing || this.data.saving || this.data.avatarReading || !event.detail.avatarUrl) return;
    this.setData({ avatarReading: true, avatarError: '' });
    try {
      let filePath = event.detail.avatarUrl;
      let info = await localFileInfo(filePath);
      if (info.size > avatarLimit) {
        const compressed = await new Promise((resolve, reject) => wx.compressImage({ src: filePath, quality: 80, compressedWidth: 256, success: resolve, fail: reject }));
        filePath = compressed.tempFilePath;
        info = await localFileInfo(filePath);
      }
      if (info.size > avatarLimit) throw new Error('头像图片过大，请选择小于 512 KB 的图片');
      const file = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: resolve, fail: reject }));
      // 图片内容只放在页面实例中，避免通过 setData 发送到渲染层。
      this._avatarBase64 = file.data;
      this.setData({ draftAvatarUrl: filePath, avatarFailed: false });
      this.updateCanSave();
    } catch (error) {
      this.setData({ avatarError: error.message || '头像未能读取，请重新选择。' });
    } finally {
      this.setData({ avatarReading: false });
    }
  },
  onAvatarError() { this.setData({ avatarFailed: true }); },
  async confirmProfile() {
    if (!this._profile || !this.data.editing || !this.data.canSave || this.data.loading || this.data.loadError || this.data.saving || this.data.avatarReading || this.data.saveConflict) return;
    const profile = { nickname: this.data.draftNickname.trim() };
    if (this._avatarBase64 !== undefined) profile.avatarBase64 = this._avatarBase64;
    this.setData({ saving: true, saveError: '' });
    try {
      this.renderProfile(await getApp().saveProfile(profile, this._profile.version));
      wx.showToast({ title: '资料已保存', icon: 'success' });
    } catch (error) {
      this.setData({ saveError: error.message || '资料未能保存，请重试。', saveConflict: error.code === 'VERSION_CONFLICT' });
    } finally {
      this.setData({ saving: false });
    }
  },
  reloadAfterConflict() {
    if (!this.data.saveConflict || this.data.saving || this.data.avatarReading) return;
    wx.showModal({
      title: '放弃填写并重新读取？',
      content: '尚未保存的昵称和头像会被清空。',
      confirmText: '重新读取', cancelText: '继续填写',
      success: async result => {
        if (!result.confirm || this.data.saving || this.data.avatarReading) return;
        this._avatarBase64 = undefined;
        this._profile = null;
        this.setData({ profile: null, editing: false, draftNickname: '', draftAvatarUrl: '', saveError: '', saveConflict: false, avatarError: '', nicknameError: '', canSave: false });
        await this.onShow();
      }
    });
  }
});
