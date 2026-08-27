# match cc
    ...
    const char kDoc[] = R"(
    >>>
    ```cpp
    ...
    <<<
    int sample = 1;
    ...
# end
# patch

    ```c++

# end
