// [ERROR] таблица IPC-макросов без единой скобки-блока
IPC_BEGIN_MESSAGE_MAP(Host, message)
  IPC_MESSAGE_HANDLER(Msg_A, OnA)
  IPC_MESSAGE_HANDLER(Msg_B, OnBrave)
  IPC_MESSAGE_UNHANDLED(handled = false)
IPC_END_MESSAGE_MAP()
