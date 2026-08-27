# match cc
    ...
    >>>
    void a(){x();}void b(){y();}void c(){z();}void d(){w();}
    <<<
    ...
# end
# patch
    void a(){x();}void b(){y2();}void c(){z();}void d(){w();}
# end
