// [BITFIELD] правка ширины битового поля в середине struct
struct Flags {
  unsigned int ready : 1;
  unsigned int level : 3;
  unsigned int spare : 4;
};
