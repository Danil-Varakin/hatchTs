// [OBJCPP] .mm: C++ namespace рядом с @implementation (частичный разбор, ERROR-узлы)
namespace media {
std::unique_ptr<Decoder> MakeDecoder() {
  return std::make_unique<Decoder>();
}
}  // namespace media

@implementation Player
- (void)play {
  decoder_ = media::MakeDecoder();
}
@end
