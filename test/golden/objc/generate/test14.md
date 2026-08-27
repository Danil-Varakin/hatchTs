# match m
    ...
    // [MSGDUP] две посылки сообщения, различитель — только литерал ВНУТРИ вложенных скобок
    - (void)reload {
    ...
    >>>
      [self.table reloadSection:0 withAnimation:[self animationFor:@"top"]];
    <<<
    ...
    }
    ...
# end
# patch
    [self.table reloadSection:1 withAnimation:[self animationFor:@"top"]];
# end
