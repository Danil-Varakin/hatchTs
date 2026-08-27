// [BITFIELD] правка ширины битового поля в середине struct
struct Flags {
  unsigned int ready : 1;
  unsigned int level : 2;
  unsigned int spare : 4;
};
