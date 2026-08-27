// [TEXTBLOCK] правка внутри текстового блока в тройных кавычках
static final String QUERY = """
        SELECT id
        FROM users
        WHERE active = 1 AND banned = 0
        """;
