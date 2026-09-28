# match cpp
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

# match cpp
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
