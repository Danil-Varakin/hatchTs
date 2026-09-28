# match cpp
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
