# match cc
    ...
    void A() {
    ...
    >>>
        Step2();
    <<<
    ...
    }
    ...
# end
# patch
    Step3();
# end
