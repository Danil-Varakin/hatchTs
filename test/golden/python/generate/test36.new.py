# [DECOR] правка МЕЖДУ двумя декораторами
class Api:
    @property
    @cached(ttl=120)
    def value(self):
        return compute()
