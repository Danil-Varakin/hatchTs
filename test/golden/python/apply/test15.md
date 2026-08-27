Правка внутри docstring, в котором лежит markdown-ограда. Ограда не может
сломать разметку: четыре пробела отступа держат её вне колонки 0.

# match python
    ...
    def slug(text):
    ...
        ```python
    ...
    >>>
        slug("Привет мир")
    <<<
    ...
        lowered = text.strip().lower()
    ...
# end
# patch
    slug("Привет, мир!")
# end
