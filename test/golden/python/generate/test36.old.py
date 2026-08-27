# [DECOR] правка МЕЖДУ двумя декораторами
class Api:
    @property
    @cached(ttl=60)
    def value(self):
        return compute()
