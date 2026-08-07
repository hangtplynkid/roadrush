const LD = require('./level_design.js');

console.log('=== LINT LIBRARY ===');
const errs = LD.lintLibrary();
if (errs.length) errs.forEach(e => console.log('  X ' + e));
else console.log('  OK');

console.log('\n=== PHASE LENGTHS ===');
LD.PHASE_DEF.forEach(pd => {
  const l = ['A','B','C'].map(k => pd.lib[k].length);
  console.log('  ' + pd.key + ': ' + l.join(' / ') + ' segments');
});

console.log('\n=== 27 COMBOS ===');
const res = LD.testAllCombos();
const pass = res.filter(r => r.pass).length;
console.log('  pass ' + pass + '/27');
res.filter(r => !r.pass).forEach(r => {
  console.log('  X ' + r.combo + ' (' + r.segs + ' segs)');
  r.failed.forEach(f => console.log('      - ' + f));
});

console.log('\n=== SAMPLE A-A-A ===');
const M = LD.buildMap({P1:'A',P2:'A',P3:'A'});
console.log('  segments: ' + M.segs.length + ' = ' + (M.segs.length*32) + 'm, need ' + Math.round(LD.NEED_DIST) + 'm');
console.log('  items: ' + M.items.map(i => i.type+'@'+Math.round(i.dist)+'m/'+i.time.toFixed(1)+'s/'+i.ctx).join(', '));
LD.validate(M).forEach(v => console.log('  ' + (v[0]?'v':'X') + ' ' + v[1] + ' :: ' + v[2]));
