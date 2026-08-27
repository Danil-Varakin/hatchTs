# match cc
    ...
    void Emit() {
    ...
    >>>
      Send("}{");
    <<<
    ...
    }
    ...
# end
# patch
    Send("}{ ");
# end
