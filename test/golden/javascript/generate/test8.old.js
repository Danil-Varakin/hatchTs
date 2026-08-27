// [ARROW] объектный литерал в скобках как тело стрелки — не блок
const toPoint = (x, y) => ({ x, y, kind: 'point' });
