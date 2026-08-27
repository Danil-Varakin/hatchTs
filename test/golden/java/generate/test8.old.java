// [METHODREF] правка в цепочке со ссылкой на метод Foo::bar
List<String> names = users.stream()
        .map(User::getName)
        .filter(Objects::nonNull)
        .collect(Collectors.toList());
