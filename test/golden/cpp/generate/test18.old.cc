// [DUP] одинаковый метод в двух классах — различает только заголовок класса
class Alpha {
 public:
  void Reset() {
    value_ = 0;
  }
};

class Beta {
 public:
  void Reset() {
    value_ = 0;
  }
};
