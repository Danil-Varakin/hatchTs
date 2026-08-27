# match m
    ...
    // [MSG] правка во ВЛОЖЕННОЙ посылке сообщения [[a b] c:d]
    - (void)refresh {
    ...
    >>>
      [[self tableView] reloadRowsAtIndexPaths:[self visiblePaths] withRowAnimation:UITableViewRowAnimationFade];
    <<<
    ...
    }
    ...
# end
# patch
    [[self tableView] reloadRowsAtIndexPaths:[self visiblePaths] withRowAnimation:UITableViewRowAnimationNone];
# end
