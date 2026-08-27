// [DUP] одинаковый код в двух ветках одного if
void Pick(bool flag) {
  if (flag) {
    Apply(kDefault);
  } else {
    Apply(kDefault);
  }
}
