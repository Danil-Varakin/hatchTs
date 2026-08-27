// [SWITCHARROW] правка в ветке switch со стрелками и yield
int weight = switch (kind) {
    case SMALL -> 1;
    case MEDIUM -> {
        log("medium");
        yield 5;
    }
    default -> 10;
};
