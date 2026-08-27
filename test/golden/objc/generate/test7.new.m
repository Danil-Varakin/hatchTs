// [PROPERTY] правка атрибутов @property в середине списка
@interface Model : NSObject
@property(nonatomic, copy) NSString *title;
@property(nonatomic, readonly) NSInteger count;
@property(nonatomic, strong) NSArray *rows;
@end
