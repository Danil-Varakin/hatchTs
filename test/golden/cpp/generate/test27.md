# match cc
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
