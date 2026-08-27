# [STRING] правка в r-строке с обратными слэшами
PATTERN = r"\d+\,\d+"


def check(text):
    return match(PATTERN, text)
