// Deterministic, rule-based decision support. NOT a trained ML model (no labelled data exists).
const { CONFIG } = require('./data');
const LABEL = { road_accident:'Road accident', cardiac:'Cardiac emergency', fire:'Fire', injury:'Injury', other:'Other' };
function levelOf(score, cfg = CONFIG.prio) { const t = cfg.thresholds; return score >= t.Critical ? 'Critical' : score >= t.High ? 'High' : score >= t.Medium ? 'Medium' : 'Low'; }
function requirements(inc, priority) {
  const hi = priority === 'Critical' || priority === 'High', text = `${inc.description} ${inc.symptoms||''}`.toLowerCase();
  switch (inc.type) {
    case 'road_accident': return { responderAnyOf: hi ? ['TRAUMA','ALS'] : ['BLS','ALS','TRAUMA'], preferred:'TRAUMA', hospitalCap: hi ? 'TRAUMA' : 'EMERGENCY' };
    case 'cardiac': return { responderAnyOf:['CARDIAC','ALS'], preferred:'CARDIAC', hospitalCap:'CARDIAC' };
    case 'fire': return { responderAnyOf:['FIRE'], preferred:'FIRE', hospitalCap: /burn|smoke|injur/.test(text) ? 'BURN' : null };
    case 'injury': return { responderAnyOf:['BLS','ALS','TRAUMA'], preferred: hi ? 'ALS' : 'BLS', hospitalCap:'EMERGENCY' };
    default: return { responderAnyOf:['BLS','ALS','TRAUMA'], preferred:'ALS', hospitalCap:'EMERGENCY' };
  }
}
function prioritize(inc, cfg = CONFIG.prio) {
  const text = `${inc.description} ${inc.symptoms||''}`.toLowerCase();
  let score = cfg.base[inc.type] ?? cfg.base.other; const reasons = [`Base score for ${LABEL[inc.type]||'Other'}: ${score}`];
  for (const [k, w] of Object.entries(cfg.keywords)) if (text.includes(k)) { score += w; reasons.push(`Danger indicator "${k}": +${w}`); }
  const extra = Math.min(inc.people, cfg.maxPeople) - 1;
  if (extra > 0) { score += extra*cfg.perPerson; reasons.push(`${inc.people} people affected: +${extra*cfg.perPerson}`); }
  score = Math.min(100, score);
  const missing = [];
  if (!inc.symptoms) missing.push('No symptoms reported');
  if ((inc.description||'').length < 15) missing.push('Description is very short');
  if (inc.type === 'other') missing.push('Incident type unspecified');
  if (['cardiac','injury','other'].includes(inc.type) && !/conscious|breath|collapsed|pulse/.test(text)) missing.push('Consciousness/breathing not stated');
  if (inc.type === 'fire' && !/people|worker|trapped|injur|burn|smoke/.test(text)) missing.push('Unknown whether anyone is trapped or injured');
  const priority = levelOf(score, cfg);
  return { score, priority, reasons, missing, requirements: requirements(inc, priority), overridden:false, method:'Rule-based scoring (0-100), not a machine-learning model' };
}
module.exports = { prioritize, requirements, levelOf };
