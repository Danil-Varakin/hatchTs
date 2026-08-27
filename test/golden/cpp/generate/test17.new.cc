// [DUP] пять одинаковых строк в одном блоке, правка третьей
void Test() {
  EXPECT_EQ(1, Get());
  EXPECT_EQ(1, Get());
  EXPECT_EQ(2, Get());
  EXPECT_EQ(1, Get());
  EXPECT_EQ(1, Get());
}
