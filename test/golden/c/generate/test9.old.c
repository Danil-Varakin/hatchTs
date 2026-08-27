// [VLA] правка размера массива переменной длины
void scale(int n, double factor) {
  double buf[n];
  for (int i = 0; i < n; i++) {
    buf[i] = factor;
  }
}
