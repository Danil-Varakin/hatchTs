// [BRACE] макрос-открывашка: `BEGIN_METADATA` без парной скобки в тексте
BEGIN_METADATA(BrowserView)
ADD_PROPERTY_METADATA(bool, Active)
END_METADATA

void After() {
  Ping();
}
