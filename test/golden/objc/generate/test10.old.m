// [PROTO] угловые скобки — СПИСОК ПРОТОКОЛОВ, а не дженерик
@interface Cell : UIView <NSCopying, NSCoding>
- (id)copyWithZone:(NSZone *)zone;
@end
