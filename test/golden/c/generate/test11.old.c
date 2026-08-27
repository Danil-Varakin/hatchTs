// [GOTO] правка в блоке очистки, на который прыгает goto
int open_all(void) {
  if (!step_one()) goto fail;
  if (!step_two()) goto fail;
  return 1;
fail:
  cleanup();
  return 0;
}
