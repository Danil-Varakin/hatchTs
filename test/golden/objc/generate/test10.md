# match objc
    ...
    >>>
    @interface Cell : UIView <NSCopying, NSCoding>
    <<<
    ...
# end
# patch
    @interface Cell : UIView <NSCopying, NSCoding, NSSecureCoding>
# end
