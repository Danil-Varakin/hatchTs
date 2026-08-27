# match cc
    ...
    void Test() {
    ...
      EXPECT_EQ(
    ...
    );
      EXPECT_EQ(
    ...
    );
    >>>
    ...
      EXPECT_EQ(
    ...
    );
      EXPECT_EQ(
    ...
    );
      EXPECT_EQ(
    ...
    );
    ...
    }
    ...
# end
# patch

      EXPECT_EQ(2, Get());
# end

# match cc
    ...
    void Test() {
    ...
      EXPECT_EQ(1, Get());
      EXPECT_EQ(1, Get());
    >>>
      EXPECT_EQ(1, Get());
    ...
    <<<
    }
    ...
# end
# patch


# end
