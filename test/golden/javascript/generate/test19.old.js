// [SUITEDUP] два describe-блока, различитель — только строка ВНУТРИ скобок
describe('parser', () => {
  it('round-trips', () => {
    expect(run()).toBe(1);
  });
});

describe('printer', () => {
  it('round-trips', () => {
    expect(run()).toBe(1);
  });
});
