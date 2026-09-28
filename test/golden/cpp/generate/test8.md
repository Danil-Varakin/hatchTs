# match cpp
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
