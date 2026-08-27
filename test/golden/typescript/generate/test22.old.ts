// [EACHDUP] заголовок родителя обрезан на «(» — различитель сидит ПЕРВЫМ аргументом
describe.each([1, 2])('alpha', () => {
  it('holds', () => {
    expect(compute()).toBe(1);
  });
});

describe.each([1, 2])('beta', () => {
  it('holds', () => {
    expect(compute()).toBe(1);
  });
});
