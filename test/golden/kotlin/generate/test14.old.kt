// [SPECDUP] два спек-блока: имя лежит ВНУТРИ скобок вызова, заголовок родителя режется на «(»
class Spec : StringSpec({
    "reads header" {
        parse(input) shouldBe 1
    }

    "reads footer" {
        parse(input) shouldBe 1
    }
})
