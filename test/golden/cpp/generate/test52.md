# match cc
    ...
    void a() {
    ...
    >>>
    }
    ...
# end
# patch
      extra();

# end

# match cc
    ...
    void b() {
    >>>
    ...
    }
    ...
# end
# patch

      target();
# end
