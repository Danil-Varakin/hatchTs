# match c
    ...
    #define STATES(X) \
      X(IDLE, 0)      \
    >>>
      X(BUSY, 1)      \
    ...
# end
# patch

      X(WAIT, 4)      \
# end
