# match cpp
    ...
    void A() {
    ...
    >>>
      Log("привет");
    <<<
    ...
    }
    ...
# end
# patch
    Log("пока");
# end
