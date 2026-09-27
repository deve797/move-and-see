function actualExerciseDate(plan) {
  const result = plan && plan.result;
  return result ? result.makeup && result.makeup.date || result.actualDate || '' : '';
}

function resultCategory(plan) {
  const result = plan && plan.result;
  if (!result) return '';
  if (result.status === 'incomplete') return result.makeup ? 'makeup' : 'incomplete';
  if (!['completed', 'replacement'].includes(result.status)) return '';
  return actualExerciseDate(plan) > plan.date ? 'makeup' : result.status;
}

module.exports = { resultCategory, actualExerciseDate };
