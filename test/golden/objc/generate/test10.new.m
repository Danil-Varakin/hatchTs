// [PROTO] угловые скобки — СПИСОК ПРОТОКОЛОВ, а не дженерик
@interface Cell : UIView <NSCopying, NSCoding, NSSecureCoding>
- (id)copyWithZone:(NSZone *)zone;
@end
