function formatRunningPace(duration, distance) {
  const decimal = /^\d+(\.\d*)?$|^\.\d+$/;
  if (!decimal.test(String(duration).trim()) || !decimal.test(String(distance).trim())) return '';
  const minutes = Number(duration);
  const kilometres = Number(distance);
  if (!Number.isFinite(minutes) || !Number.isFinite(kilometres) || minutes <= 0 || kilometres <= 0) return '';
  const seconds = Math.round(minutes / kilometres * 60);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return '';
  return Math.floor(seconds / 60) + '′' + String(seconds % 60).padStart(2, '0') + '″/公里';
}

module.exports = formatRunningPace;
